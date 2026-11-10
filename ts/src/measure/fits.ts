import { open } from 'node:fs/promises'

const blockBytes = 2880
const cardBytes = 80

export type HeaderValue = string | number | boolean

function parseValue(text: string): HeaderValue {
  const trimmed = text.trim()

  if (trimmed.startsWith("'")) {
    let value = ''
    let index = 1

    while (index < trimmed.length) {
      if (trimmed[index] === "'") {
        if (trimmed[index + 1] !== "'") break
        index += 1
      }
      value += trimmed[index]
      index += 1
    }

    return value.trimEnd()
  }

  const bare = (trimmed.split('/')[0] ?? '').trim()

  if (bare === 'T') return true
  if (bare === 'F') return false

  const number = Number(bare)

  return bare !== '' && Number.isFinite(number) ? number : bare
}

export function headerOf(bytes: Buffer): ReadonlyMap<string, HeaderValue> | undefined {
  const header = new Map<string, HeaderValue>()

  for (let offset = 0; offset + cardBytes <= bytes.length; offset += cardBytes) {
    const card = bytes.toString('latin1', offset, offset + cardBytes)
    const key = card.slice(0, 8).trim()

    if (key === 'END') return header
    if (card.slice(8, 10) === '= ') header.set(key, parseValue(card.slice(10)))
  }

  return undefined
}

export async function readHeader(path: string): Promise<ReadonlyMap<string, HeaderValue>> {
  const file = await open(path)

  try {
    let read = Buffer.alloc(0)

    for (;;) {
      const block = Buffer.alloc(blockBytes)
      const { bytesRead } = await file.read(block, 0, blockBytes, read.length)

      if (bytesRead === 0) throw new Error('the FITS header has no END card')

      read = Buffer.concat([read, block.subarray(0, bytesRead)])

      const header = headerOf(read)

      if (header !== undefined) return header
    }
  } finally {
    await file.close()
  }
}
