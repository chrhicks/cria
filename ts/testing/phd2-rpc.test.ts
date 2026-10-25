import { createServer, type Server, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script with JSDoc types, not part of a TypeScript project
import { LineReader, classify, encodeRequest, parseArgs, runStep, settle, steps } from '../deploy/phd2-rpc.mjs'

type Handler = (request: { method: string; params?: Record<string, unknown>; id: number }, socket: Socket) => void

/** A stand-in for PHD2's event server: CRLF lines out, one JSON request per line in. */
class FakePhd2 {
  requests: Array<{ method: string; params?: Record<string, unknown>; id: number }> = []
  raw: string[] = []
  sockets = new Set<Socket>()
  server: Server
  port = 0

  constructor(private readonly handler: Handler) {
    this.server = createServer(socket => {
      this.sockets.add(socket)
      socket.setEncoding('utf8')
      socket.write('{"Event":"Version","PHDVersion":"2.6.14","PHDSubver":"","MsgVersion":1}\r\n')
      const reader = new LineReader()
      socket.on('data', chunk => {
        for (const line of reader.push(chunk as string)) {
          this.raw.push(line)
          const request = JSON.parse(line)
          this.requests.push(request)
          this.handler(request, socket)
        }
      })
      socket.on('error', () => undefined)
    })
  }

  async listen(): Promise<void> {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    this.port = (this.server.address() as AddressInfo).port
  }

  close(): void {
    this.server.close()
    for (const socket of this.sockets) socket.destroy()
  }
}

const reply = (id: number, result: unknown) => `{"jsonrpc":"2.0","result":${JSON.stringify(result)},"id":${id}}\r\n`
const settleDone = (status: number) => `{"Event":"SettleDone","Status":${status}${status ? ',"Error":"timed out"' : ''},"TotalFrames":4,"DroppedFrames":0}\r\n`

let fake: FakePhd2 | undefined
afterEach(() => fake?.close())

async function run(name: string, handler: Handler, options: Record<string, unknown> = {}, waitSeconds = 5) {
  fake = new FakePhd2(handler)
  await fake.listen()
  const out: string[] = []
  const err: string[] = []
  const step = name === 'watch' ? null : steps[name]({ pixels: 3, recalibrate: false, ...options })
  const code = await runStep({ host: '127.0.0.1', port: fake.port, step, watchSeconds: 0.2, waitSeconds, pollMs: 10 }, { out: line => out.push(line), err: line => err.push(line) })
  return { code, out, err }
}

describe('framing', () => {
  it('ends a request with CRLF and sends one JSON object per line', () => {
    expect(encodeRequest(7, { method: 'loop', done: 'reply', waitSeconds: 1 })).toBe('{"method":"loop","id":7}\r\n')
    expect(encodeRequest(7, steps.connect({ pixels: 3, recalibrate: false }))).toBe('{"method":"set_connected","params":{"connected":true},"id":7}\r\n')
  })

  it('joins a line that arrives in pieces and strips CRLF', () => {
    const reader = new LineReader()
    expect(reader.push('{"Event":"Ver')).toEqual([])
    expect(reader.push('sion"}\r\n{"Event":"A"}\r')).toEqual(['{"Event":"Version"}'])
    expect(reader.push('\n\r\n')).toEqual(['{"Event":"A"}'])
  })

  it('tells replies, events and noise apart', () => {
    expect(classify('{"jsonrpc":"2.0","result":0,"id":1}')).toEqual({ kind: 'reply', id: 1, result: 0 })
    expect(classify('{"jsonrpc":"2.0","error":{"code":1,"message":"no star"},"id":1}')).toMatchObject({ kind: 'reply', id: 1, error: 'no star' })
    expect(classify('{"Event":"GuideStep","Frame":3}')).toMatchObject({ kind: 'event', name: 'GuideStep' })
    expect(classify('not json')).toEqual({ kind: 'other' })
  })
})

describe('steps', () => {
  it('sends the settle tolerance Chris chose: 1.5 px for 10 s, timeout 90 s', () => {
    expect(settle).toEqual({ pixels: 1.5, time: 10, timeout: 90 })
    expect(steps.guide({ pixels: 3, recalibrate: false }).params).toEqual({ settle, recalibrate: false })
    expect(steps.dither({ pixels: 3, recalibrate: false }).params).toEqual({ amount: 3, raOnly: false, settle })
  })

  it('has one subcommand for each step Chris asked for', () => {
    expect(Object.keys(steps).sort()).toEqual(['connect', 'disconnect', 'dither', 'find-star', 'guide', 'loop', 'state', 'stop'])
  })

  it('rejects unknown subcommands, stray words and a flag with no value', () => {
    expect(parseArgs(['guide', 'now'])).toBeNull()
    expect(parseArgs(['restart'])).toBeNull()
    expect(parseArgs(['state', '--port'])).toBeNull()
    expect(parseArgs(['watch', '15'])).toEqual({ name: 'watch', options: { seconds: '15' } })
  })
})

describe('runStep against a fake PHD2', () => {
  it('sends only the step asked for and prints every line PHD2 sends', async () => {
    const { code, out } = await run('state', (request, socket) => socket.write(`{"Event":"AppState","State":"Stopped"}\r\n${reply(request.id, 'Stopped')}`))
    expect(code).toBe(0)
    expect(fake?.raw).toEqual(['{"method":"get_app_state","id":1}'])
    expect(out).toEqual(['{"Event":"Version","PHDVersion":"2.6.14","PHDSubver":"","MsgVersion":1}', '{"Event":"AppState","State":"Stopped"}', '{"jsonrpc":"2.0","result":"Stopped","id":1}'])
  })

  it('exits 2 and says why when PHD2 answers with an error', async () => {
    const { code, err } = await run('find-star', (request, socket) => socket.write(`{"jsonrpc":"2.0","error":{"code":1,"message":"could not find star"},"id":${request.id}}\r\n`))
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('could not find star')
  })

  it('guide waits for SettleDone and exits 0 on success', async () => {
    const { code } = await run('guide', (request, socket) => {
      socket.write(reply(request.id, 0))
      setTimeout(() => socket.write(`{"Event":"GuideStep","Frame":1}\r\n${settleDone(0)}`), 20)
    })
    expect(code).toBe(0)
    expect(fake?.requests).toEqual([{ method: 'guide', params: { settle, recalibrate: false }, id: 1 }])
  })

  it('dither exits 2 when PHD2 reports that it did not settle', async () => {
    const { code, err } = await run('dither', (request, socket) => {
      socket.write(reply(request.id, 0))
      socket.write(settleDone(1))
    })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('did not settle: timed out')
    expect(fake?.requests[0]).toMatchObject({ method: 'dither', params: { amount: 3, raOnly: false, settle } })
  })

  it('ignores a SettleDone that arrives before the reply', async () => {
    const { code } = await run('guide', (request, socket) => {
      socket.write(settleDone(1))
      setTimeout(() => socket.write(reply(request.id, 0) + settleDone(0)), 20)
    })
    expect(code).toBe(0)
  })

  it('times out when PHD2 never answers, and says PHD2 may still be working', async () => {
    const { code, err } = await run('loop', () => undefined, {}, 0.2)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('no reply within 0.2 s')
  })

  it('exits 2 when PHD2 hangs up', async () => {
    const { code, err } = await run('loop', (_request, socket) => socket.destroy())
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('PHD2 closed the connection')
  })

  it('stop is finished only when PHD2 says Stopped, not when it accepts the request', async () => {
    const states = ['Guiding', 'Guiding', 'Stopped']
    const { code } = await run('stop', (request, socket) => socket.write(reply(request.id, request.method === 'get_app_state' ? states.shift() : 0)))
    expect(code).toBe(0)
    expect(fake?.requests.map(request => request.method)).toEqual(['stop_capture', 'get_app_state', 'get_app_state', 'get_app_state'])
  })

  it('stop exits 2 and says the outcome is unknown when PHD2 never reports Stopped', async () => {
    const { code, err } = await run('stop', (request, socket) => socket.write(reply(request.id, 'Guiding')), {}, 0.2)
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('no Stopped state within 0.2 s')
    expect(err.join('\n')).toContain('outcome is unknown')
  })

  it('watch sends nothing', async () => {
    const { code, out } = await run('watch', () => undefined)
    expect(code).toBe(0)
    expect(fake?.raw).toEqual([])
    expect(out).toHaveLength(1)
  })
})

describe('runStep when nothing listens', () => {
  it('exits 2', async () => {
    const probe = createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise(resolve => probe.close(resolve))
    const err: string[] = []
    const code = await runStep({ host: '127.0.0.1', port, step: steps.state({ pixels: 3, recalibrate: false }), waitSeconds: 1 }, { out: () => undefined, err: line => err.push(line) })
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('ECONNREFUSED')
  })
})
