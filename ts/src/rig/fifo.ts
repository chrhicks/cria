import { constants } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'

const held = new Map<string, Promise<FileHandle>>()

function heldOpen(path: string): Promise<FileHandle> {
  const known = held.get(path)

  if (known) return known

  const opening = open(path, constants.O_RDWR | constants.O_NONBLOCK)

  held.set(path, opening)
  opening.then(undefined, () => held.delete(path))

  return opening
}

export async function writeFifo(path: string, line: string): Promise<void> {
  const handle = await heldOpen(path)

  await handle.write(`${line}\n`)
}
