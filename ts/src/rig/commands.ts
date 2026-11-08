import { connect } from '@nats-io/transport-node'
import { Option, Schema } from 'effect'
import { brokerSettings } from '../stream/broker.ts'
import type { StreamSettings } from '../stream/config.ts'
import { parseRecord, stringField } from '../stream/json.ts'
import { keepRunning } from '../stream/retry.ts'
import type { RigConfig, RigDevice } from './config.ts'
import type { IndiLink } from './indi-link.ts'

const Command = Schema.Struct({
  id: Schema.NonEmptyString,
  property: Schema.NonEmptyString,
  values: Schema.Record(Schema.String, Schema.Union([Schema.Finite, Schema.Boolean, Schema.String])),
  by: Schema.NonEmptyString,
})

type Command = typeof Command.Type

export interface CommandAnswer {
  readonly id: string
  readonly by: string
  readonly device: string
  readonly property: string
  readonly result: 'written' | 'refused'
  readonly reason?: string
}

export interface Commands {
  readonly receive: (device: string, payload: string) => Promise<void>
}

interface CommandDependencies {
  readonly config: RigConfig
  readonly indi: Pick<IndiLink, 'property' | 'write'>
  readonly answer: (answer: CommandAnswer) => void
  readonly log: (line: string) => void
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const ownedBy = (device: RigDevice) => new Set(['CONNECTION', ...Object.keys(device.properties), ...Object.keys(device.onConnect)])

export function createCommands({ config, indi, answer, log }: CommandDependencies): Commands {
  function refusal(device: RigDevice, command: Command): string | undefined {
    if (indi.property(device.indiDevice, command.property) === undefined) return `${device.id} has no property ${command.property}`
    if (ownedBy(device).has(command.property)) return `${command.property} is kept by the rig file`

    return undefined
  }

  async function write(device: RigDevice, command: Command) {
    const reason = refusal(device, command)
    const base = { id: command.id, by: command.by, device: device.id, property: command.property }

    if (reason !== undefined) {
      log(`rig: ${device.id}: command ${command.id} from ${command.by} for ${command.property} refused: ${reason}`)
      answer({ ...base, result: 'refused', reason })

      return
    }

    try {
      await indi.write(device.indiDevice, command.property, command.values)
    } catch (error) {
      log(`rig: ${device.id}: command ${command.id} from ${command.by} for ${command.property} not sent: ${errorText(error)}`)
      answer({ ...base, result: 'refused', reason: errorText(error) })

      return
    }

    log(`rig: ${device.id}: command ${command.id} from ${command.by}: wrote ${command.property} (${Object.keys(command.values).join(', ')})`)
    answer({ ...base, result: 'written' })
  }

  return {
    receive(deviceId, payload) {
      const device = config.devices.find(candidate => candidate.id === deviceId)
      const record = parseRecord(payload)
      const decoded = Schema.decodeUnknownOption(Command)(record)
      const heard = { id: record && stringField(record, 'id') || '', by: record && stringField(record, 'by') || '', device: deviceId, property: record && stringField(record, 'property') || '' }
      const refuse = (reason: string) => {
        log(`rig: ${deviceId}: command ${heard.id || '(no id)'} refused: ${reason}`)
        answer({ ...heard, result: 'refused', reason })

        return Promise.resolve()
      }

      if (device === undefined) return refuse(`${deviceId} is not in the rig file`)
      if (Option.isNone(decoded)) return refuse('not a command: it needs id, property, values and by')

      return write(device, decoded.value)
    },
  }
}

export function followCommands(options: { readonly settings: StreamSettings; readonly devices: ReadonlyArray<string>; readonly commands: Commands; readonly log: (line: string) => void }) {
  const { settings, devices, commands, log } = options

  return keepRunning({
    name: 'commands',
    retryMs: settings.retrySeconds * 1000,
    log,
    run: async () => {
      const connection = await connect({ ...brokerSettings(settings.broker), name: 'rig-commands', waitOnFirstConnect: true, maxReconnectAttempts: -1 })

      for (const device of devices) {
        connection.subscribe(`rig-dev.command.${device}`, {
          callback: (error, message) => {
            if (error) log(`commands: ${error.message}`)
            else void commands.receive(device, message.string())
          },
        })
      }

      return connection.closed()
    },
  })
}
