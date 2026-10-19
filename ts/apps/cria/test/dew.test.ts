import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeIndi } from '@cria/fake-indi'
import { addDewHeaters, connection, pegasusDew } from './drivers.js'
import { allReady, noneNotRead, startCria, until, type Cria } from './harness.js'

const box = 'Fake PPBA'
const overrideMs = 500
let fake: FakeIndi
let cria: Cria

beforeEach(async () => {
  fake = new FakeIndi()
  await fake.start()
  fake.define(connection(box))
  addDewHeaters(fake, box)
  fake.behaviour = pegasusDew({ overrideMs })
  cria = await startCria(fake.port, [
    {
      id: 'switch',
      kind: 'switch',
      indiDevice: box,
      channels: [
        { name: 'Dew A duty (%)', property: 'DEW_DUTY_CYCLES', element: 'DEW_CHANNEL_1', automaticWhileOn: 'Auto dew' },
        { name: 'Dew B duty (%)', property: 'DEW_DUTY_CYCLES', element: 'DEW_CHANNEL_2', automaticWhileOn: 'Auto dew' },
        { name: 'Auto dew', property: 'AUTO_DEW_CONTROL', element: 'DEW_CHANNEL_1' },
      ],
    },
  ])
  await cria.waitFor(allReady(['switch']))
  await cria.waitFor(noneNotRead)
})

afterEach(async () => {
  await cria.stop()
  await fake.stop()
})

const dutySent = () => fake.received.filter(xml => xml.startsWith('<new') && xml.includes('name="DEW_DUTY_CYCLES"')).length
const duty = (element: string) => fake.vector(box, 'DEW_DUTY_CYCLES').elements[element]!.value

describe('dew duty under auto dew', () => {
  it('refuses a manual duty while auto dew is on, before sending anything, and says how to take control', async () => {
    const operation = await cria.run('switch', 'switch-set', { channelId: 1, value: 20 })

    expect([operation.kind, operation.reason, operation.message]).toEqual([
      'failed',
      'invalid',
      'Dew B duty (%) is set automatically while Auto dew is on; switch Auto dew (channel 2) off first',
    ])
    expect(dutySent()).toBe(0)
  })

  it('takes a manual duty once auto dew is switched off, and the duty stays', async () => {
    expect(await cria.run('switch', 'switch-set', { channelId: 2, value: 0 })).toMatchObject({ kind: 'confirmed', values: { value: 0 } })

    const operation = await cria.run('switch', 'switch-set', { channelId: 0, value: 20 })

    expect([operation.kind, operation.values]).toEqual(['confirmed', { value: 20 }])
    await new Promise(resolve => setTimeout(resolve, 2 * overrideMs))
    expect(duty('DEW_CHANNEL_1')).toBe(20)
  })

  it('confirms a duty the box quantizes (10 % holds as 9.8039 %) and reports what it holds', async () => {
    await cria.run('switch', 'switch-set', { channelId: 2, value: 0 })

    const operation = await cria.run('switch', 'switch-set', { channelId: 0, value: 10 })

    expect([operation.kind, operation.values]).toEqual(['confirmed', { value: 9.803921568627452 }])
    await until('the reading to show the held duty', async () => {
      const device = await cria.device('switch')

      return device.kind === 'switch' && device.channels[0]!.value.status === 'fresh' && device.channels[0]!.value.value === 9.803921568627452
    })
  })
})
