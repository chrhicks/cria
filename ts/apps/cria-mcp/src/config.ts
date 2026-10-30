import { Config, Duration, Schema } from 'effect'

const CriaUrl = Schema.URL.pipe(
  Schema.check(Schema.makeFilter((url: URL) => (url.username === '' && url.password === '') || 'must not carry credentials; the bearer token is CRIA_TOKEN')),
)

export const mcpConfig = Config.all({
  port: Config.Port('CRIA_MCP_PORT'),
  origin: Config.schema(CriaUrl, 'CRIA_URL'),
  token: Config.option(Config.Redacted('CRIA_TOKEN')),
  replyTimeout: Config.Duration('CRIA_REPLY_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
})

export type McpConfig = Config.Success<typeof mcpConfig>
