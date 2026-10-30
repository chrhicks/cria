import { Config, Duration } from 'effect'

export const mcpConfig = Config.all({
  port: Config.Port('CRIA_MCP_PORT'),
  origin: Config.URL('CRIA_URL'),
  token: Config.option(Config.Redacted('CRIA_TOKEN')),
  replyTimeout: Config.Duration('CRIA_REPLY_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
})

export type McpConfig = Config.Success<typeof mcpConfig>
