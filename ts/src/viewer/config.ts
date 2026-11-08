import { homedir } from 'node:os'
import { join } from 'node:path'
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
  highlightsFile: described(
    'Where the viewer keeps highlights: time ranges with a title, a note and a search, marked on the page or by an agent so others can open the same moment. Read and written by the viewer alone',
    Schema.String,
    join(homedir(), '.local', 'state', 'rig-stream', 'highlights.json'),
  ),
  maxAgeDays: described(
    'Days the dev stream keeps messages. Throwaway data: long enough to look back across a few iterations. 668 MB over 2.3 days (about 290 MB a day) was measured on 2026-11-07 with raw XML only; entries that also carry what the parser read are about 31% bigger (measured on 19,721 wire entries from one idle hour)',
    Schema.Number,
    7,
  ),
})
