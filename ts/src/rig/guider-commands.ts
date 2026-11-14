import { Option, Schema } from 'effect'
import { parseRecord, stringField } from '../stream/json.ts'
import type { CommandAnswer } from './commands.ts'

export const guiderDevice = 'phd2'

const GuiderCommand = Schema.Struct({
  id: Schema.NonEmptyString,
  by: Schema.NonEmptyString,
  method: Schema.NonEmptyString,
  params: Schema.optionalKey(Schema.Unknown),
})

interface GuiderDependencies {
  readonly send: (line: string) => boolean
  readonly answer: (answer: CommandAnswer) => void
  readonly log: (line: string) => void
}

export function createGuiderCommands({ send, answer, log }: GuiderDependencies) {
  return {
    receive(payload: string) {
      const record = parseRecord(payload)
      const decoded = Schema.decodeUnknownOption(GuiderCommand)(record)

      if (Option.isNone(decoded)) {
        const heard = { id: (record && stringField(record, 'id')) || '', by: (record && stringField(record, 'by')) || '', device: guiderDevice, property: (record && stringField(record, 'method')) || '' }

        log(`rig: phd2: command ${heard.id || '(no id)'} refused: not a guider command`)
        answer({ ...heard, result: 'refused', reason: 'not a guider command: it needs id, by and method' })

        return
      }

      const { id, by, method, params } = decoded.value
      const sent = send(JSON.stringify({ method, ...(params === undefined ? {} : { params }), id }))

      log(`rig: phd2: command ${id} from ${by}: ${method} ${sent ? 'sent' : 'refused: PHD2 is not connected'}`)
      answer({ id, by, device: guiderDevice, property: method, result: sent ? 'written' : 'refused', ...(sent ? {} : { reason: 'PHD2 is not connected' }) })
    },
  }
}
