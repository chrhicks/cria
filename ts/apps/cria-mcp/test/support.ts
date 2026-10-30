import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duration, Effect, type Scope } from 'effect'

export const tsRoot = join(import.meta.dirname, '..', '..', '..')

const closeServer = (server: Server) =>
  Effect.promise(
    () =>
      new Promise<void>(resolve => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )

export const freePort = Effect.promise(
  () =>
    new Promise<number>((resolve, reject) => {
      const server = createNetServer()

      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number }

        server.close(() => resolve(port))
      })
    }),
)

export type FakeHandler = (request: IncomingMessage, response: ServerResponse) => void

export interface FakeCria {
  readonly origin: string
  readonly requests: Array<{ readonly method: string | undefined; readonly url: string | undefined; readonly headers: IncomingMessage['headers'] }>
}

/** A stand-in HTTP server for Cria. It answers whatever the test tells it to, so it can be laxer than the real one. */
export const startFakeCria = (handler: FakeHandler): Effect.Effect<FakeCria, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ server: Server; cria: FakeCria }>(resolve => {
          const requests: FakeCria['requests'] = []
          const server = createServer((request, response) => {
            requests.push({ method: request.method, url: request.url, headers: request.headers })
            handler(request, response)
          })

          server.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as { port: number }

            resolve({ server, cria: { origin: `http://127.0.0.1:${port}`, requests } })
          })
        }),
    ),
    ({ server }) => closeServer(server),
  ).pipe(Effect.map(({ cria }) => cria))

export const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

export interface McpProcess {
  readonly url: string
  readonly log: () => string
}

export const startMcp = (env: Record<string, string>): Effect.Effect<McpProcess, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const port = yield* freePort
    const url = `http://127.0.0.1:${port}/mcp`
    const childEnv: NodeJS.ProcessEnv = { ...process.env, CRIA_MCP_PORT: String(port), ...env }

    if (!('CRIA_TOKEN' in env)) delete childEnv.CRIA_TOKEN
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        spawn(process.execPath, ['--conditions=@cria/source', '--import', join(tsRoot, 'testing', 'source-hook.mjs'), join(tsRoot, 'apps', 'cria-mcp', 'src', 'main.ts')], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: childEnv,
        }),
      ),
      child => Effect.sync(() => void child.kill('SIGTERM')),
    )
    let output = ''

    child.stdout.on('data', chunk => void (output += String(chunk)))
    child.stderr.on('data', chunk => void (output += String(chunk)))

    const listening = Effect.callback<void, Error>(resume => {
      const check = () => {
        if (output.includes('Listening on')) resume(Effect.void)
      }

      child.stdout.on('data', check)
      child.stderr.on('data', check)
      child.once('exit', () => resume(Effect.fail(new Error(`the MCP server exited before it listened:\n${output}`))))
      check()
    })

    yield* listening.pipe(Effect.timeoutOrElse({ duration: Duration.seconds(20), orElse: () => Effect.fail(new Error(`the MCP server did not listen in 20 s:\n${output}`)) }))

    return { url, log: () => output }
  })

export interface RpcAnswer {
  readonly status: number
  readonly headers: Headers
  readonly message: { readonly id?: number; readonly result?: any; readonly error?: any } | undefined
}

const parseMessage = (contentType: string, text: string, id: number | undefined): RpcAnswer['message'] => {
  if (text === '') return undefined
  const payloads = contentType.startsWith('text/event-stream')
    ? text.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5)) as NonNullable<RpcAnswer['message']>)
    : [JSON.parse(text) as NonNullable<RpcAnswer['message']>]

  return payloads.find(payload => id === undefined || payload.id === id)
}

/**
 * An MCP client over Streamable HTTP that sends what Executor's MCP detection sends:
 * `Accept: application/json, text/event-stream`, an `initialize` for 2025-11-25, then
 * `notifications/initialized`, `tools/list` and `tools/call` carrying the `mcp-session-id`
 * and `mcp-protocol-version` headers from the initialize reply.
 */
export const mcpClient = (url: string, headers: Record<string, string> = {}) => {
  let sessionHeaders: Record<string, string> = {}
  let nextId = 1

  const post = (method: string, params: unknown, expectAnswer: boolean): Effect.Effect<RpcAnswer, Error> =>
    Effect.tryPromise({
      try: async () => {
        const id = expectAnswer ? nextId++ : undefined
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...sessionHeaders, ...headers },
          body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
        })
        const text = await response.text()

        return { status: response.status, headers: response.headers, message: parseMessage(response.headers.get('content-type') ?? '', text, id) }
      },
      catch: error => new Error(`${method}: ${String(error)}`),
    })

  const initialize = Effect.gen(function* () {
    const answer = yield* post('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cria-mcp-test', version: '0.0.0' } }, true)
    const session = answer.headers.get('mcp-session-id')

    sessionHeaders = {
      'mcp-protocol-version': answer.message?.result?.protocolVersion ?? '2025-11-25',
      ...(session === null ? {} : { 'mcp-session-id': session }),
    }
    yield* post('notifications/initialized', undefined, false)

    return answer
  })

  return {
    initialize,
    listTools: post('tools/list', undefined, true),
    callTool: (name: string, args: unknown = {}) => post('tools/call', { name, arguments: args }, true),
  }
}

/** Calls a tool the way code-mode would and returns the structured result. */
export const callState = (url: string, headers: Record<string, string> = {}) =>
  Effect.gen(function* () {
    const client = mcpClient(url, headers)

    yield* client.initialize

    const answer = yield* client.callTool('state')

    return answer.message?.result as { isError?: boolean; structuredContent?: any; content?: ReadonlyArray<{ type: string; text: string }> }
  })

export interface RealCria {
  readonly origin: string
}

/** A real Cria process (apps/cria/src/main.ts) on a fake INDI server. Read-only: commands are disabled. */
export const startRealCria = (indiPort: number, options: { readonly token?: string } = {}): Effect.Effect<RealCria, Error, Scope.Scope> =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'cria-mcp-real-'))),
      path => Effect.promise(() => rm(path, { recursive: true, force: true })),
    )
    const config = join(directory, 'cria.json')

    yield* Effect.promise(() =>
      writeFile(
        config,
        JSON.stringify({
          listen: { host: '127.0.0.1', port: 0 },
          indi: { host: '127.0.0.1', port: indiPort },
          imageDirectory: join(directory, 'images'),
          livenessMs: 500,
          acknowledgeMs: 2000,
          commandsEnabled: false,
          devices: [
            { id: 'camera', kind: 'camera', indiDevice: 'Fake CCD' },
            { id: 'mount', kind: 'mount', indiDevice: 'Fake Mount' },
          ],
        }),
      ),
    )

    const env = { ...process.env }

    delete env.CRIA_TOKEN
    if (options.token !== undefined) env.CRIA_TOKEN = options.token
    const child = yield* Effect.acquireRelease(
      Effect.sync(() =>
        spawn(process.execPath, ['--conditions=@cria/source', '--import', join(tsRoot, 'testing', 'source-hook.mjs'), join(tsRoot, 'apps', 'cria', 'src', 'main.ts'), config], {
          stdio: ['ignore', 'ignore', 'pipe'],
          env,
        }),
      ),
      child => Effect.sync(() => void child.kill('SIGTERM')),
    )

    return yield* Effect.callback<RealCria, Error>(resume => {
      let log = ''

      child.stderr!.on('data', chunk => {
        log += String(chunk)
        const port = /listening on (\d+)/.exec(log)?.[1]

        if (port !== undefined) resume(Effect.succeed({ origin: `http://127.0.0.1:${port}` }))
      })
      child.once('exit', () => resume(Effect.fail(new Error(`Cria exited before it listened:\n${log}`))))
    }).pipe(Effect.timeoutOrElse({ duration: Duration.seconds(20), orElse: () => Effect.fail(new Error('Cria did not listen in 20 s')) }))
  })
