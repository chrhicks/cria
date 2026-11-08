import { JetStreamApiCodes, JetStreamApiError, RetentionPolicy, StorageType, type JetStreamManager } from '@nats-io/jetstream'
import { nanos } from '@nats-io/transport-node'
import { Schema } from 'effect'
import { described } from '../config.ts'
import { BrokerLogin } from './broker.ts'
import { streamName, streamSubjects } from './subjects.ts'

export const EnsureSettings = Schema.Struct({
  broker: BrokerLogin,
  maxAgeDays: described(
    'Days the dev stream keeps messages. Throwaway data: long enough to look back across a few iterations, at about 230 MB a day idle, estimated from the 125 MB measured before the entry format',
    Schema.Number,
    7,
  ),
})

const isMissing = (error: unknown) => error instanceof JetStreamApiError && error.apiError().err_code === JetStreamApiCodes.StreamNotFound

export async function ensureStream(manager: Pick<JetStreamManager, 'streams'>, maxAgeDays: number): Promise<'created' | 'updated'> {
  const config = { subjects: streamSubjects, storage: StorageType.File, retention: RetentionPolicy.Limits, max_age: nanos(maxAgeDays * 24 * 3600 * 1000) }
  const exists = await manager.streams.info(streamName).then(
    () => true,
    (error: unknown) => (isMissing(error) ? false : Promise.reject(error)),
  )

  if (exists) await manager.streams.update(streamName, config)
  else await manager.streams.add({ name: streamName, ...config })

  return exists ? 'updated' : 'created'
}
