import { createServer } from 'node:http'
import { Layer } from 'effect'
import { McpProtocol, McpServer } from 'effect/ai'
import { FetchHttpClient, HttpRouter } from 'effect/http'
import { NodeFileSystem, NodeHttpServer } from '@effect/platform-node'
import { Cria } from './cria.js'
import { ImageCache } from './image-cache.js'
import type { McpConfig } from './config.js'
import { CommandHandlers, CommandToolkit } from './tools/commands.js'
import { RouteHandlers, RouteToolkit } from './tools/routes.js'

const noRedirects = Layer.succeed(FetchHttpClient.RequestInit, { redirect: 'error' })

export const serverLayer = (config: McpConfig) => {
  const mcp = McpServer.layerHttp({
    name: 'cria',
    version: '0.0.0',
    path: '/mcp',
    protocols: [McpProtocol.v2025_11_25],
  })

  const cria = Cria.layer(config)
  const images = ImageCache.layer({ directory: config.imageDirectory, downloadTimeout: config.downloadTimeout }).pipe(Layer.provide(cria), Layer.provide(NodeFileSystem.layer))

  const tools = Layer.mergeAll(McpServer.toolkit(RouteToolkit), McpServer.toolkit(CommandToolkit)).pipe(
    Layer.provide(Layer.mergeAll(RouteHandlers, CommandHandlers)),
    Layer.provide(Layer.mergeAll(cria, images)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(noRedirects),
    Layer.provide(mcp),
  )

  return HttpRouter.serve(tools).pipe(Layer.provide(NodeHttpServer.layer(createServer, { host: '127.0.0.1', port: config.port })))
}
