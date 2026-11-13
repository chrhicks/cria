import { connect } from '@nats-io/transport-node'
import { Effect, Option, Schema } from 'effect'
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

const kind = <const Tag extends string>(tag: Tag) => Schema.withDecodingDefaultKey<Schema.Literal<Tag>>(Effect.succeed(tag))(Schema.Literal(tag))

const Direction = Schema.Literals(['north', 'south', 'east', 'west'])

type Direction = typeof Direction.Type

const Message = Schema.Union([
  Schema.Struct({ _tag: kind('Write'), ...Command.fields }),
  Schema.Struct({ _tag: kind('Nudge'), id: Schema.NonEmptyString, by: Schema.NonEmptyString, nudge: Direction, rate: Schema.NonEmptyString }),
  Schema.Struct({ _tag: kind('Hold'), id: Schema.NonEmptyString, by: Schema.NonEmptyString, hold: Schema.NonEmptyString }),
  Schema.Struct({ _tag: kind('Release'), id: Schema.NonEmptyString, by: Schema.NonEmptyString, release: Schema.NonEmptyString }),
])

type Message = typeof Message.Type

interface Axis {
  readonly property: string
  readonly toward: string
  readonly away: string
}

const axes: Readonly<Record<Direction, Axis>> = {
  north: { property: 'TELESCOPE_MOTION_NS', toward: 'MOTION_NORTH', away: 'MOTION_SOUTH' },
  south: { property: 'TELESCOPE_MOTION_NS', toward: 'MOTION_SOUTH', away: 'MOTION_NORTH' },
  east: { property: 'TELESCOPE_MOTION_WE', toward: 'MOTION_EAST', away: 'MOTION_WEST' },
  west: { property: 'TELESCOPE_MOTION_WE', toward: 'MOTION_WEST', away: 'MOTION_EAST' },
}

const slewRate = 'TELESCOPE_SLEW_RATE'

interface Held {
  readonly id: string
  readonly by: string
  readonly device: RigDevice
  readonly axis: Axis
  readonly cancelLease: () => void
}

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
  readonly schedule: (ms: number, run: () => void) => () => void
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const failureOf = (writing: Promise<void>): Promise<string | undefined> => writing.then(() => undefined, errorText)

const ownedBy = (device: RigDevice) => new Set(['CONNECTION', ...Object.keys(device.properties), ...Object.keys(device.onConnect)])

export function createCommands({ config, indi, answer, log, schedule }: CommandDependencies): Commands {
  let held: Held | undefined

  function refusal(device: RigDevice, property: string): string | undefined {
    if (indi.property(device.indiDevice, property) === undefined) return `${device.id} has no property ${property}`
    if (ownedBy(device).has(property)) return `${property} is kept by the rig file`

    return undefined
  }

  async function write(device: RigDevice, command: Command) {
    const reason = refusal(device, command.property)
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

  async function letGo(why: string) {
    const was = held

    if (was === undefined) return

    held = undefined
    was.cancelLease()

    const failed = await failureOf(indi.write(was.device.indiDevice, was.axis.property, { [was.axis.toward]: false, [was.axis.away]: false }))

    log(`rig: ${was.device.id}: nudge ${was.id} from ${was.by} ${why}: ${was.axis.property} off${failed === undefined ? '' : ` not sent: ${failed}`}`)
  }

  const lease = (id: string) => schedule(config.nudgeLeaseMs, () => void (held?.id === id ? letGo(`had no word for ${config.nudgeLeaseMs} ms`) : undefined))

  async function nudge(device: RigDevice, start: Extract<Message, { readonly _tag: 'Nudge' }>) {
    const axis = axes[start.nudge]
    const base = { id: start.id, by: start.by, device: device.id, property: axis.property }
    const reason = refusal(device, slewRate) ?? refusal(device, axis.property) ?? (indi.property(device.indiDevice, slewRate)?.elements.has(start.rate) === true ? undefined : `${slewRate} has no rate ${start.rate}`)

    if (reason !== undefined) {
      log(`rig: ${device.id}: nudge ${start.id} from ${start.by} refused: ${reason}`)
      answer({ ...base, result: 'refused', reason })

      return
    }

    await letGo(`replaced by ${start.id}`)

    const failed = await failureOf(indi.write(device.indiDevice, slewRate, { [start.rate]: true }).then(() => indi.write(device.indiDevice, axis.property, { [axis.toward]: true, [axis.away]: false })))

    if (failed !== undefined) {
      log(`rig: ${device.id}: nudge ${start.id} from ${start.by} not sent: ${failed}`)
      answer({ ...base, result: 'refused', reason: failed })

      return
    }

    held = { id: start.id, by: start.by, device, axis, cancelLease: lease(start.id) }
    log(`rig: ${device.id}: nudge ${start.id} from ${start.by}: ${axis.toward} at ${start.rate}`)
    answer({ ...base, result: 'written' })
  }

  function hold(id: string) {
    const current = held

    if (current?.id !== id) return

    current.cancelLease()
    held = { ...current, cancelLease: lease(id) }
  }

  async function release(device: RigDevice, message: Extract<Message, { readonly _tag: 'Release' }>) {
    const property = held?.id === message.release ? held.axis.property : ''

    if (held?.id === message.release) await letGo('released')
    answer({ id: message.id, by: message.by, device: device.id, property, result: 'written' })
  }

  return {
    receive(deviceId, payload) {
      const device = config.devices.find(candidate => candidate.id === deviceId)
      const record = parseRecord(payload)
      const decoded = Schema.decodeUnknownOption(Message)(record)
      const heard = { id: record && stringField(record, 'id') || '', by: record && stringField(record, 'by') || '', device: deviceId, property: record && stringField(record, 'property') || '' }
      const refuse = (reason: string) => {
        log(`rig: ${deviceId}: command ${heard.id || '(no id)'} refused: ${reason}`)
        answer({ ...heard, result: 'refused', reason })

        return Promise.resolve()
      }

      if (device === undefined) return refuse(`${deviceId} is not in the rig file`)
      if (Option.isNone(decoded)) return refuse('not a command: it needs id, property, values and by')

      const message = decoded.value

      switch (message._tag) {
        case 'Write':
          return write(device, message)
        case 'Nudge':
          return nudge(device, message)
        case 'Hold':
          return Promise.resolve(hold(message.hold))
        case 'Release':
          return release(device, message)
      }
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
