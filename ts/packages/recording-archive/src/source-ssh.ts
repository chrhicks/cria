/**
 * errai over ssh. Every call is one shell script run on the remote side by `spawnRemote`
 * (`ssh <host> <script>` in production, `sh -c <script>` in tests, so the real scripts run against a temp
 * folder). Session names are checked against the session pattern before they reach a script, and quoted anyway.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { ArchiveError, type SourceFile } from './files.js'
import { assertSessionName, pinFile, pruningSuffix, type Source, type SourceEntry } from './source.js'

export type SpawnRemote = (script: string) => ChildProcess

export const spawnSsh =
  (host: string): SpawnRemote =>
  script =>
    spawn('ssh', ['-o', 'BatchMode=yes', host, script], { stdio: ['pipe', 'pipe', 'pipe'] })

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`

async function collect(child: ChildProcess, input?: string): Promise<string> {
  let out = ''
  let err = ''

  child.stdout?.on('data', chunk => void (out += chunk))
  child.stderr?.on('data', chunk => void (err += chunk))
  child.stdin?.end(input ?? '')

  const [code] = (await once(child, 'close')) as [number | null]

  if (code !== 0) throw new ArchiveError(`remote command failed (exit ${code}): ${err.trim().slice(0, 300)}`)

  return out
}

export function sshSource(options: { spawnRemote: SpawnRemote; directory: string }): Source {
  const { spawnRemote, directory } = options
  const run = (script: string, input?: string) => collect(spawnRemote(script), input)
  const inside = (name: string) => {
    assertSessionName(name)

    return `cd ${quote(`${directory}/${name}`)}`
  }

  return {
    list: async () => {
      const script = `cd ${quote(directory)} && for p in ./*; do [ -e "$p" ] || [ -L "$p" ] || continue; n=\${p#./}; if [ -L "$p" ]; then t=symlink; elif [ -d "$p" ]; then t=folder; else t=other; fi; m=$(stat -c %Y "$p/traffic.jsonl" 2>/dev/null || stat -c %Y "$p"); k=0; [ -e "$p/${pinFile}" ] && k=1; printf '%s\\t%s\\t%s\\t%s\\n' "$n" "$t" "$m" "$k"; done`
      const lines = (await run(script)).split('\n').filter(line => line !== '')

      return lines.map((line): SourceEntry => {
        const [name, kind, seconds, pinned] = line.split('\t')

        if (name === undefined || (kind !== 'folder' && kind !== 'symlink' && kind !== 'other') || !/^\d+$/.test(seconds ?? '')) throw new ArchiveError(`unreadable listing line: ${line.slice(0, 120)}`)

        return { name, kind, lastWriteMs: Number(seconds) * 1000, pinned: pinned === '1' }
      })
    },
    inventory: async name => {
      const lines = (await run(`${inside(name)} && find . -mindepth 1 \\( -type f -printf 'f\\t%s\\t%P\\n' -o -type d -printf 'd\\t0\\t%P\\n' -o -printf 'x\\t0\\t%P\\n' \\)`)).split('\n').filter(line => line !== '')
      const files: SourceFile[] = []

      for (const line of lines) {
        const [type, size, path] = line.split('\t')

        if (type === 'x') throw new ArchiveError(`${path} is not a regular file or folder`)
        if (type === 'f' && path !== undefined && /^\d+$/.test(size ?? '')) files.push({ path, size: Number(size) })
        else if (type !== 'd') throw new ArchiveError(`unreadable inventory line: ${line.slice(0, 120)}`)
      }

      return files.sort((a, b) => (a.path < b.path ? -1 : 1))
    },
    hashes: async (name, paths) => {
      const hashes = new Map<string, string>()

      if (paths.length === 0) return hashes

      const out = await run(`${inside(name)} && xargs -0 sha256sum --`, paths.map(path => `${path}\0`).join(''))

      for (const line of out.split('\n').filter(text => text !== '')) {
        const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)

        if (!match) throw new ArchiveError(`unreadable sha256sum line: ${line.slice(0, 120)}`)
        hashes.set(match[2]!, match[1]!)
      }

      return hashes
    },
    fetch: async (name, into) => {
      assertSessionName(name)
      await mkdir(into, { recursive: true })
      const sender = spawnRemote(`tar -C ${quote(directory)} -cf - ${quote(name)}`)
      const receiver = spawn('tar', ['-xf', '-', '-C', into], { stdio: ['pipe', 'ignore', 'pipe'] })
      let senderError = ''
      let receiverError = ''

      sender.stderr?.on('data', chunk => void (senderError += chunk))
      receiver.stderr?.on('data', chunk => void (receiverError += chunk))
      const senderDone = once(sender, 'close') as Promise<[number | null]>
      const receiverDone = once(receiver, 'close') as Promise<[number | null]>

      await pipeline(sender.stdout!, receiver.stdin!)

      const [[senderCode], [receiverCode]] = await Promise.all([senderDone, receiverDone])

      if (senderCode !== 0) throw new ArchiveError(`remote tar failed (exit ${senderCode}): ${senderError.trim().slice(0, 300)}`)
      if (receiverCode !== 0) throw new ArchiveError(`local tar failed (exit ${receiverCode}): ${receiverError.trim().slice(0, 300)}`)
    },
    remove: async name => {
      assertSessionName(name)
      await run(`cd ${quote(directory)} && mv -- ${quote(name)} ${quote(`${name}${pruningSuffix}`)} && rm -rf -- ${quote(`${name}${pruningSuffix}`)}`)
    },
  }
}
