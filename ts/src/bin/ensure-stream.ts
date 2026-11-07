import { jetstreamManager } from '@nats-io/jetstream'
import { connect } from '@nats-io/transport-node'
import { Effect } from 'effect'
import { ensureStream, StreamConfig } from '../stream/ensure.ts'
import { brokerSettings, streamName } from '../stream/index.ts'

const config = await Effect.runPromise(Effect.provide(Effect.service(StreamConfig), StreamConfig.layer))
const broker = await connect({ ...brokerSettings(config.broker), name: 'rig-stream-ensure' })
const outcome = await ensureStream(await jetstreamManager(broker), config.maxAgeDays).finally(() => broker.close())

console.log(`stream ${streamName}: ${outcome}`)
