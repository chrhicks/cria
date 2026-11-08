import { Schema } from 'effect'
import { described } from '../config.ts'
import { BrokerLogin } from '../stream/index.ts'

export const ViewerSettings = Schema.Struct({
  port: Schema.Number.annotate({ description: 'Local port the page is served on' }),
  broker: BrokerLogin,
  historyReadBatch: described(
    'Entries asked of the broker at a time when reading history. The client library defaults to 100; 2048 read 200,000 entries in 0.8 s on thuban, 2026-11-06',
    Schema.Number,
    2048,
  ),
  rowsKeptOnPage: described(
    "Newest matching entries sent to one page and kept on it, so a tab stays responsive: about 7 minutes of the idle rig at 280 a minute. The page's own speed at this size was not measured",
    Schema.Number,
    2000,
  ),
  maxAgeDays: described(
    'Days the dev stream keeps messages. Throwaway data: long enough to look back across a few iterations, at about 230 MB a day idle, estimated from the 125 MB measured before the entry format',
    Schema.Number,
    7,
  ),
})
