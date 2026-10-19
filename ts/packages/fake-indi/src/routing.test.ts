import { readFileSync } from 'node:fs'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi } from './server.js'

/**
 * Who hears what, and exactly what they hear, against real indiserver 2.2.5: the table is
 * measure/measure-routing.py's output, where a scripted driver sends each kind of output and every client
 * setup records what it received. The fake does the same through its own methods; each client must receive
 * the same elements, attribute for attribute.
 */
interface Row {
  readonly title: string
  readonly before: ReadonlyArray<string>
  readonly fake: { readonly op: string; readonly [key: string]: unknown }
  readonly heard: Readonly<Record<string, ReadonlyArray<string>>>
}

const measured: { readonly indiserver: string; readonly clients: Readonly<Record<string, ReadonlyArray<string>>>; readonly emissions: ReadonlyArray<Row> } = JSON.parse(
  readFileSync(new URL('./message-routing.json', import.meta.url), 'utf8'),
)

const [a, b] = ['Scripted A', 'Scripted B']

let fake: FakeIndi | undefined
let sockets: net.Socket[] = []

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets = []
  await fake?.stop()
  fake = undefined
})

const entities = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!)

/** What a client can tell apart: not the whitespace around values (Cria trims them), attribute order or the time indiserver stamps. */
function canonical(xml: string): string {
  return xml
    .replace(/<(\w+)([^>]*?)(\/?)>/g, (_, tag: string, attributes: string, close: string) => {
      const found = [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1]!, entities(match[2]!)] as const).filter(([name]) => name !== 'timestamp')

      return `<${tag}${found.sort(([x], [y]) => x.localeCompare(y)).map(([name, value]) => ` ${name}=${JSON.stringify(value)}`).join('')}${close}>`
    })
    .replace(/\s+/g, ' ')
    .replace(/> /g, '>')
    .replace(/ </g, '<')
    .trim()
}

const elements = (text: string) =>
  [...text.matchAll(/<(\w+)\b[^>]*?\/>|<(\w+)\b[^>]*>[\s\S]*?<\/\2>/g)].map(match => match[0]).filter(xml => !xml.startsWith('<pingReply uid="settle')).map(canonical)

async function connect(port: number, commands: ReadonlyArray<string>) {
  const socket = net.connect(port, '127.0.0.1')
  let text = ''

  sockets.push(socket)
  socket.on('data', chunk => void (text += chunk.toString('utf8')))
  await new Promise(resolve => socket.once('connect', resolve))
  if (commands.length > 0) socket.write(commands.join(''))

  return {
    socket,
    take: () => {
      const taken = text

      text = ''

      return taken
    },
  }
}

async function settle(clients: ReadonlyArray<{ readonly socket: net.Socket; readonly take: () => string }>) {
  const uid = `settle-${Math.random().toString(36).slice(2)}`
  const seen = new Map<(typeof clients)[number], string>(clients.map(client => [client, '']))

  for (const client of clients) client.socket.write(`<pingRequest uid="${uid}"/>`)
  for (let waited = 0; ; waited += 5) {
    for (const client of clients) seen.set(client, seen.get(client)! + client.take())
    if ([...seen.values()].every(text => text.includes(`<pingReply uid="${uid}"/>`))) break
    if (waited > 5000) throw new Error('a client did not answer a ping')
    await new Promise(resolve => setTimeout(resolve, 5))
  }

  return clients.map(client => seen.get(client)!)
}

const newVector: Parameters<FakeIndi['define']>[0] = {
  device: a,
  name: 'NEW',
  kind: 'text',
  perm: 'rw',
  label: 'New',
  group: 'Main',
  timeout: 60,
  state: 'Ok',
  elements: { V: { value: 'v', label: 'V' } },
}

describe('what each kind of driver output reaches, and what it says', () => {
  it.each(measured.emissions.map(row => [row.title, row] as const))('%s', async (_title, row) => {
    fake = new FakeIndi()
    await fake.start()
    for (const device of [a, b]) fake.define({ device, name: 'EMIT', kind: 'text', perm: 'rw', label: 'Emit', group: 'Main', timeout: 60, state: 'Ok', elements: { XML: { value: '', label: 'XML' } } })

    const names = Object.keys(measured.clients)
    const clients = await Promise.all(names.map(name => connect(fake!.port, measured.clients[name]!)))

    await settle(clients)
    if (row.before.length > 0) fake.define({ ...newVector, elements: { V: { value: 'v', label: 'V' } } })
    await settle(clients)

    const op = row.fake as Record<string, any>

    switch (op.op) {
      case 'message':
        fake.message(op.device, op.text)
        break
      case 'update':
        fake.update(op.device, op.name, { state: op.state, values: op.values, ...(op.message === undefined ? {} : { message: op.message }) })
        break
      case 'define':
        fake.define({ ...newVector, elements: { V: { value: 'v', label: 'V' } } }, op.message === undefined ? {} : { message: op.message })
        break
      case 'removeVector':
        fake.removeVector(op.device, op.name, op.message === undefined ? {} : { message: op.message })
        break
      case 'removeDevice':
        fake.removeDevice(op.device, op.message === undefined ? {} : { message: op.message })
        break
      case 'image': {
        await fake.deliverBlob(op.device, op.name, op.element, Buffer.from(op.data, 'base64'), { format: op.format, timeout: op.timeout, message: op.message })
        break
      }
      case 'ping':
      case 'none':
        break
      default:
        throw new Error(`unknown op ${op.op}`)
    }
    if (op.op === 'ping') clients[names.indexOf(op.client)]!.socket.write(`<pingRequest uid="${op.uid}"/>`)

    const heard = await settle(clients)
    const got = Object.fromEntries(names.map((name, index) => [name, elements(heard[index]!)]))
    const expected = Object.fromEntries(names.map(name => [name, row.heard[name]!.map(canonical)]))

    expect(got).toEqual(expected)
  })
})

/**
 * Which images and which other output a client receives, for every ordered sequence of up to three
 * commands over two devices: measure/measure-blob-scope.py. Each row is the commands, then whether the
 * client received an image for A.IMG, one for B.IMG, an update of A.EMIT and one of B.EMIT.
 */
describe('images and the rest, for every sequence of up to three commands over two devices', () => {
  const table: { readonly commands: ReadonlyArray<string>; readonly rows: ReadonlyArray<string> } = JSON.parse(readFileSync(new URL('./blob-scope.json', import.meta.url), 'utf8'))
  const deviceOf = (letter: string) => `Scripted ${letter}`

  const xml = (command: string) => {
    const [verb, target] = command.split(' ') as [string, string]
    const [letter, property] = target.split('.') as [string, string | undefined]

    if (verb === 'ask') return letter === '*' ? '<getProperties version="1.7"/>' : `<getProperties version="1.7" device="${deviceOf(letter)}"/>`

    return `<enableBLOB device="${deviceOf(letter)}"${property === undefined ? '' : ` name="${property}"`}>${verb}</enableBLOB>`
  }

  it('matches every measured row', async () => {
    fake = new FakeIndi()
    await fake.start()
    for (const device of [a, b]) {
      fake.define({ device, name: 'EMIT', kind: 'text', perm: 'rw', state: 'Ok', elements: { XML: { value: '' } } })
      fake.define({ device, name: 'IMG', kind: 'blob', perm: 'ro', state: 'Idle', elements: { IMG: { value: '' } } })
    }

    const wrong: string[] = []

    for (let from = 0; from < table.rows.length; from += 150) {
      const rows = table.rows.slice(from, from + 150).map(row => {
        const [sequence, results] = row.split('=') as [string, string]

        return { row, commands: sequence === '' ? [] : sequence.split(',').map(index => table.commands[Number(index)]!), results }
      })
      const clients = await Promise.all(rows.map(({ commands }) => connect(fake!.port, commands.map(xml))))

      await settle(clients)
      await fake.deliverBlob(a, 'IMG', 'IMG', Buffer.from('AAAA', 'base64'))
      const imageA = await settle(clients)
      await fake.deliverBlob(b, 'IMG', 'IMG', Buffer.from('AAAA', 'base64'))
      const imageB = await settle(clients)
      fake.update(a, 'EMIT', { state: 'Ok', values: { XML: 'x' } })
      const otherA = await settle(clients)
      fake.update(b, 'EMIT', { state: 'Ok', values: { XML: 'x' } })
      const otherB = await settle(clients)

      rows.forEach(({ row, commands }, index) => {
        const got = [imageA[index]!.includes('<setBLOBVector'), imageB[index]!.includes('<setBLOBVector'), otherA[index]!.includes('<setTextVector'), otherB[index]!.includes('<setTextVector')].map(Number).join('')

        if (got !== row.split('=')[1]) wrong.push(`${commands.join(', ') || 'no commands'}: indiserver ${row.split('=')[1]}, fake ${got}`)
      })
      for (const client of clients) client.socket.destroy()
    }

    expect(table.rows).toHaveLength(3616)
    expect(wrong).toEqual([])
  }, 120_000)
})
