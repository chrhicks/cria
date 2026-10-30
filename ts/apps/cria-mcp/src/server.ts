import { createServer } from 'node:http'
import { Layer } from 'effect'
import { McpProtocol, McpServer } from 'effect/ai'
import { FetchHttpClient, HttpRouter } from 'effect/http'
import { NodeHttpServer } from '@effect/platform-node'
import { Cria } from './cria.js'
import type { McpConfig } from './config.js'
import { RouteHandlers, RouteToolkit } from './tools/routes.js'

const noRedirects = Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' })

export const serverLayer = (config: McpConfig) => {
  const mcp = McpServer.layerHttp({
    name: 'cria',
    version: '0.0.0',
    path: '/mcp',
    protocols: [McpProtocol.v2025_11_25],
  })

  const tools = McpServer.toolkit(RouteToolkit).pipe(
    Layer.provide(RouteHandlers),
    Layer.provide(Cria.layer(config)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(noRedirects),
    Layer.provide(mcp),
  )

  return HttpRouter.serve(tools).pipe(Layer.provide(NodeHttpServer.layer(createServer, { host: '127.0.0.1', port: config.port })))
}
