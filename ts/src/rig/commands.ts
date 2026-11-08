import { connect } from '@nats-io/transport-node'
import { Option, Schema } from 'effect'
import type { Property, Values } from '../indi/index.ts'
import { brokerSettings } from '../stream/broker.ts'
import type { StreamSettings } from '../stream/config.ts'
import { parseRecord, stringField } from '../stream/json.ts'
import { keepRunning } from '../stream/retry.ts'
import type { RigConfig, RigDevice } from './config.ts'
import type { IndiLink } from './indi-link.ts'

export const stopProperties = {
  value: ['TELESCOPE_ABORT_MOTION', 'CCD_ABORT_EXPOSURE', 'FOCUS_ABORT_MOTION'],
  description:
    "Properties that stop a motion or an exposure, written as soon as they arrive, ahead of any command waiting. Source: indi_getprop on errai 2026-11-07 (read only): the ZWO AM5 defines TELESCOPE_ABORT_MOTION, both ZWO cameras CCD_ABORT_EXPOSURE, the ZWO EAF FOCUS_ABORT_MOTION; the Pegasus PPBA defines none. POST_MERIDIAN_TRACK.STOP on the AM5 is a mode, not a stop, and is not listed",
} as const

const Command = Schema.Struct({
  id: Schema.NonEmptyString,
  run: Schema.String,
  at: Schema.Finite,
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
  readonly run: string
  readonly now: () => number
  readonly indi: Pick<IndiLink, 'property' | 'write'>
  readonly answer: (answer: CommandAnswer) => void
  readonly log: (line: string) => void
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isStop = (property: string) => (stopProperties.value as ReadonlyArray<string>).includes(property)

const ownedBy = (device: RigDevice) => new Set(['CONNECTION', ...Object.keys(device.properties), ...Object.keys(device.onConnect)])

function misfit(property: Property, values: Values): string | undefined {
  const names = Object.keys(values)

  if (names.length === 0) return 'no element given'

  for (const name of names) {
    const element = property.elements.get(name)
    const value = values[name]

    if (element === undefined) return `${property.name} has no element ${name}`

    switch (element.kind) {
      case 'number':
        if (typeof value !== 'number') return `${name} must be a number`
        if (element.max > element.min && (value < element.min || value > element.max)) return `${name} must be from ${element.min} to ${element.max}`
        break
      case 'switch':
        if (typeof value !== 'boolean') return `${name} must be true or false`
        break
      case 'text':
        if (typeof value !== 'string') return `${name} must be text`
        break
      default:
        return `${name} cannot be written`
    }
  }

  const on = names.filter(name => values[name] === true).length

  if (property.rule === 'OneOfMany' && on !== 1) return `${property.name} takes exactly one element on`
  if (property.rule === 'AtMostOne' && on > 1) return `${property.name} takes at most one element on`

  return undefined
}

export function createCommands({ config, run, now, indi, answer, log }: CommandDependencies): Commands {
  const seen = new Set<string>()
  let waiting: Promise<void> = Promise.resolve()

  function refusal(device: RigDevice, command: Command): string | undefined {
    if (command.run !== run) return 'meant for another run of the rig program'

    const age = now() - command.at

    if (age > config.commandMaxAgeMs) return `sent ${Math.round(age / 1000)} s ago, older than the ${config.commandMaxAgeMs / 1000} s a command may be`
    if (age < -config.commandMaxAgeMs) return `dated ${Math.round(-age / 1000)} s ahead of this clock`

    const property = indi.property(device.indiDevice, command.property)

    if (property === undefined) return `${device.id} has no property ${command.property}`
    if (property.perm === 'ro' || property.kind === 'light' || property.kind === 'blob') return `${command.property} is read-only`
    if (ownedBy(device).has(command.property)) return `${command.property} is kept by the rig file`

    return misfit(property, command.values)
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
      if (Option.isNone(decoded)) return refuse('not a command: it needs id, run, at, property, values and by')

      const command = decoded.value

      if (seen.has(command.id)) return refuse('this id was already seen in this run')
      seen.add(command.id)

      if (isStop(command.property)) return write(device, command)

      waiting = waiting.then(() => write(device, command))

      return waiting
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
