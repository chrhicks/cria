import { JetStreamApiError } from '@nats-io/jetstream'
import { describe, expect, it } from 'vitest'
import { ensureStream } from './ensure.ts'

const missing = () => new JetStreamApiError({ code: 404, err_code: 10059, description: 'stream not found' })

function manager(existing: boolean, failure?: Error) {
  const calls: Array<[string, unknown]> = []
  const streams = {
    info: async (name: string) => {
      calls.push(['info', name])
      if (failure) throw failure
      if (!existing) throw missing()

      return {}
    },
    add: async (config: unknown) => void calls.push(['add', config]),
    update: async (name: string, config: unknown) => void calls.push(['update', { name, config }]),
  }

  return { calls, manager: { streams } as never }
}

describe('ensureStream', () => {
  it('creates the stream with file storage, limits retention and the age, when it is missing', async () => {
    const { calls, manager: broker } = manager(false)

    expect(await ensureStream(broker, 7)).toBe('created')
    expect(calls[1]).toEqual(['add', { name: 'RIG_DEV', subjects: ['rig-dev.>'], storage: 'file', retention: 'limits', max_age: 7 * 24 * 3600 * 1_000_000_000 }])
  })

  it('updates the stream to the same settings when it exists, so a changed age takes effect', async () => {
    const { calls, manager: broker } = manager(true)

    expect(await ensureStream(broker, 3)).toBe('updated')
    expect(calls[1]).toEqual(['update', { name: 'RIG_DEV', config: { subjects: ['rig-dev.>'], storage: 'file', retention: 'limits', max_age: 3 * 24 * 3600 * 1_000_000_000 } }])
  })

  it('does not create the stream when the broker failed for another reason', async () => {
    const { calls, manager: broker } = manager(false, new Error('no responders'))

    await expect(ensureStream(broker, 7)).rejects.toThrow('no responders')
    expect(calls).toEqual([['info', 'RIG_DEV']])
  })
})
