import { constants } from 'node:fs'
import { open } from 'node:fs/promises'

export async function writeFifo(path: string, line: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_NONBLOCK)

  try {
    await handle.write(`${line}\n`)
  } finally {
    await handle.close()
  }
}
