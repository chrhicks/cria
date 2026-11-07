import { Schema } from 'effect'
import { ConnectResult, Health } from '../src/connect/wire.ts'

const strict = { onExcessProperty: 'error' } as const

export class CriaContractError extends Error {
  override readonly name = 'CriaContractError'
}

export function makeCriaClient(base: string, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, value: unknown, what: string): S['Type'] => {
    try {
      return Schema.decodeUnknownSync(schema)(value, strict)
    } catch (error) {
      throw new CriaContractError(`${what} broke the protocol 6 contract: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    async health() {
      return decode(Health, await (await fetch(`${base}/health`)).json(), 'GET /health')
    },
    async connect(request: { readonly deviceId: string; readonly connected: boolean }) {
      const response = await fetch(`${base}/connect`, { method: 'POST', body: JSON.stringify(request) })
      const json: unknown = await response.json()

      return response.status === 200 ? { status: 200, body: decode(ConnectResult, json, 'POST /connect') } : { status: response.status, body: json }
    },
  }
}

export type CriaClient = ReturnType<typeof makeCriaClient>
