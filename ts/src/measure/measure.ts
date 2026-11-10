import { stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from '@nats-io/transport-node'
import { Option, Schema } from 'effect'
import { brokerSettings } from '../stream/broker.ts'
import type { StreamSettings } from '../stream/config.ts'
import { parseRecord, stringField } from '../stream/json.ts'
import { keepRunning } from '../stream/retry.ts'
import type { Astap, Solve, Stars } from './astap.ts'
import type { HeaderValue } from './fits.ts'

export const measureSubject = 'rig-dev.command.measure'

export const frameName = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.fits$/

export const headerKeys = ['DATE-OBS', 'EXPTIME', 'OBJECT', 'IMAGETYP', 'FOCALLEN', 'XPIXSZ', 'YPIXSZ', 'NAXIS1', 'NAXIS2', 'XBINNING', 'YBINNING', 'GAIN', 'OFFSET', 'FOCUSPOS', 'FOCUSTEM', 'CCD-TEMP', 'PIERSIDE', 'OBJCTRA', 'OBJCTDEC'] as const

const Request = Schema.Struct({
  id: Schema.NonEmptyString,
  by: Schema.NonEmptyString,
  file: Schema.String,
  measure: Schema.Array(Schema.Literals(['solve', 'stars'])).check(Schema.isMinLength(1, { expected: 'at least one of solve and stars' })),
  remove: Schema.Boolean,
})

export type MeasureAnswer =
  | { readonly id: string; readonly by: string; readonly file: string; readonly result: 'refused' | 'not removed'; readonly reason: string }
  | {
      readonly id: string
      readonly by: string
      readonly file: string
      readonly result: 'measured'
      readonly seconds: number
      readonly solve?: Solve
      readonly stars?: Stars
      readonly header: Readonly<Record<string, HeaderValue>>
      readonly remove: 'after this entry' | 'kept'
    }

export interface MeasureDependencies {
  readonly folder: string | undefined
  readonly astap: Astap | undefined
  readonly readHeader: (path: string) => Promise<ReadonlyMap<string, HeaderValue>>
  readonly store: (answer: MeasureAnswer) => Promise<void>
  readonly answer: (answer: MeasureAnswer) => void
  readonly remove: (path: string) => Promise<void>
  readonly exists: (path: string) => Promise<boolean>
  readonly now: () => number
  readonly log: (line: string) => void
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const fileExists = (path: string) => stat(path).then(found => found.isFile(), () => false)

export const removeFile = (path: string) => rm(path)

export function createMeasure(dependencies: MeasureDependencies) {
  const { folder, astap, readHeader, store, answer, remove, exists, now, log } = dependencies
  let queue: Promise<void> = Promise.resolve()

  async function measure(request: typeof Request.Type) {
    const heard = { id: request.id, by: request.by, file: request.file }
    const refuse = (reason: string) => {
      log(`rig: measure ${request.id} from ${request.by} for ${request.file || '(no file)'} refused: ${reason}`)
      answer({ ...heard, result: 'refused', reason })
    }

    if (folder === undefined || astap === undefined) return refuse('measure is not set up in the rig file')
    if (!frameName.test(request.file)) return refuse('not a frame name in the measure folder')

    const path = join(folder, request.file)

    if (!(await exists(path))) return refuse(`${request.file} is not in the measure folder`)

    const started = now()
    let header: ReadonlyMap<string, HeaderValue>

    try {
      header = await readHeader(path)
    } catch (error) {
      return refuse(`the FITS header could not be read: ${errorText(error)}`)
    }

    const solve = request.measure.includes('solve') ? await astap.solve(path, header) : undefined
    const stars = request.measure.includes('stars') ? await astap.stars(path) : undefined
    const kept = Object.fromEntries(headerKeys.filter(key => header.has(key)).map(key => [key, header.get(key)!]))

    await store({ ...heard, result: 'measured', seconds: Math.round(now() - started) / 1000, ...(solve && { solve }), ...(stars && { stars }), header: kept, remove: request.remove ? 'after this entry' : 'kept' })
    log(`rig: measure ${request.id} from ${request.by}: ${request.file} ${solve === undefined ? '' : solve.solved ? 'solved' : `not solved (${solve.reason})`}${stars === undefined ? '' : stars.measured ? ` ${stars.count} stars` : ` no stars (${stars.reason})`}`)

    if (!request.remove) return

    try {
      await remove(path)
    } catch (error) {
      log(`rig: measure ${request.id}: ${request.file} not removed: ${errorText(error)}`)
      answer({ ...heard, result: 'not removed', reason: errorText(error) })
    }
  }

  return {
    receive(payload: string): Promise<void> {
      const record = parseRecord(payload)
      const decoded = Schema.decodeUnknownOption(Request)(record)

      if (Option.isNone(decoded)) {
        const heard = { id: (record && stringField(record, 'id')) || '', by: (record && stringField(record, 'by')) || '', file: (record && stringField(record, 'file')) || '' }

        log(`rig: measure ${heard.id || '(no id)'} refused: not a measure request`)
        answer({ ...heard, result: 'refused', reason: 'not a measure request: it needs id, by, file, measure (solve, stars) and remove' })

        return Promise.resolve()
      }

      queue = queue.then(() => measure(decoded.value)).catch(error => log(`rig: measure ${decoded.value.id} failed: ${errorText(error)}`))

      return queue
    },
  }
}

export type Measure = ReturnType<typeof createMeasure>

export function followMeasure(options: { readonly settings: StreamSettings; readonly measure: Measure; readonly log: (line: string) => void }) {
  const { settings, measure, log } = options

  return keepRunning({
    name: 'measure',
    retryMs: settings.retrySeconds * 1000,
    log,
    run: async () => {
      const connection = await connect({ ...brokerSettings(settings.broker), name: 'rig-measure', waitOnFirstConnect: true, maxReconnectAttempts: -1 })

      connection.subscribe(measureSubject, {
        callback: (error, message) => {
          if (error) log(`measure: ${error.message}`)
          else void measure.receive(message.string())
        },
      })

      return connection.closed()
    },
  })
}
