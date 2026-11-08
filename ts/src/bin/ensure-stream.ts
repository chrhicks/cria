import { jetstreamManager } from '@nats-io/jetstream'
import { connect } from '@nats-io/transport-node'
import { readConfig } from '../config.ts'
import { ensureStream } from '../stream/ensure.ts'
import { ViewerSettings } from '../viewer/config.ts'
import { brokerSettings, streamName } from '../stream/index.ts'

const config = readConfig(ViewerSettings, process.argv[2])
const broker = await connect({ ...brokerSettings(config.broker), name: 'rig-stream-ensure' })
const outcome = await ensureStream(await jetstreamManager(broker), config.maxAgeDays).finally(() => broker.close())

console.log(`stream ${streamName}: ${outcome}`)
