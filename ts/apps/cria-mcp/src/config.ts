import { isAbsolute } from 'node:path'
import { Config, Duration, Schema } from 'effect'

const CriaUrl = Schema.URL.pipe(
  Schema.check(Schema.makeFilter((url: URL) => (url.username === '' && url.password === '') || 'must not carry credentials; the bearer token is CRIA_TOKEN')),
)

const AbsolutePath = Schema.String.pipe(Schema.check(Schema.makeFilter((path: string) => isAbsolute(path) || 'must be an absolute path')))

export const mcpConfig = Config.all({
  port: Config.Port('CRIA_MCP_PORT'),
  origin: Config.schema(CriaUrl, 'CRIA_URL'),
  token: Config.option(Config.Redacted('CRIA_TOKEN')),
  replyTimeout: Config.Duration('CRIA_REPLY_TIMEOUT').pipe(Config.withDefault(Duration.seconds(10))),
  imageDirectory: Config.schema(AbsolutePath, 'CRIA_MCP_IMAGE_DIR'),
  downloadTimeout: Config.Duration('CRIA_MCP_DOWNLOAD_TIMEOUT').pipe(Config.withDefault(Duration.minutes(5))),
})

export type McpConfig = Config.Success<typeof mcpConfig>
