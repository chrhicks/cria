/**
 * DERIVED cases: the closest behaviour to a non-mount device that ends a command
 * `uncertain`, built from the recorded drivers' words. The recordings of 2026-10-19 to
 * 2026-10-31 hold no real non-mount failure (every exposure, focuser move, camera abort
 * and relay or dew write was answered within 1.1 s and arrived), so nothing here is
 * recorded; docs/testing.md, "Cases from recorded failures", says which is which. Each
 * case asserts what Vela is told (kind, reason) and that only the mount holds (cria#34):
 * the device is not held and the next command is admitted.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi, connection } from '@cria/fake-indi'
import { addDewHeaters, addEaf, appliesNothing } from './drivers.js'
import { allReady, noneNotRead, startCria, type Cria } from './harness.js'

const eaf = 'ZWO EAF'
let fake: FakeIndi
let cria: Cria

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

async function startFocuser(options: Parameters<typeof addEaf>[2], wrap: (inner: ReturnType<typeof addEaf>) => ReturnType<typeof addEaf> = inner => inner) {
  fake = new FakeIndi()
  await fake.start()
  fake.behaviour = wrap(addEaf(fake, eaf, options))
  cria = await startCria(fake.port, [{ id: 'focuser', kind: 'focuser', indiDevice: eaf }], { acknowledgeMs: 600 })
  await cria.waitFor(allReady(['focuser']))
  await cria.waitFor(noneNotRead)
}

const move = (position: number) => cria.run('focuser', 'focuser-move', { position, minPosition: 1, maxPosition: 200_000 })
const held = async (id: string) => (await cria.device(id)).quarantine.held

describe('a focuser move that ends Ok short of the target (derived)', () => {
  it('is uncertain, naming where it stopped; the focuser is not held and the next move is admitted', async () => {
    await startFocuser({ position: 30000, stopsShortBy: 200 })

    const first = await move(31000)

    expect(first).toMatchObject({ kind: 'uncertain', reason: 'not-confirmed', quarantined: false })
    expect(first.message).toBe('Focuser stopped at 30800, short of 31000')
    expect(await held('focuser')).toBe(false)

    const next = await cria.submit('focuser', 'focuser-move', { position: 30500, minPosition: 1, maxPosition: 200_000 })

    expect(next.status).toBe(202)
    expect((await cria.settled(next.body.id)).reason).toBe('not-confirmed')
  })
})

describe('a focuser that never answers a move (derived)', () => {
  it('is uncertain with no acknowledgement, Cria writes the move once and then aborts; not held, next move admitted', async () => {
    await startFocuser({ position: 30000 }, inner => (fake_, vector, values) => (vector.name === 'ABS_FOCUS_POSITION' ? 'handled' : inner(fake_, vector, values)))

    const first = await move(31000)

    expect(first).toMatchObject({ kind: 'uncertain', reason: 'no-acknowledgement', quarantined: false })
    expect(fake.received.filter(xml => xml.startsWith('<new') && xml.includes('name="ABS_FOCUS_POSITION"')).length).toBe(1)
    expect(fake.received.some(xml => xml.startsWith('<new') && xml.includes('name="FOCUS_ABORT_MOTION"'))).toBe(true)
    expect(await held('focuser')).toBe(false)
    expect((await cria.submit('focuser', 'focuser-move', { position: 30500, minPosition: 1, maxPosition: 200_000 })).status).toBe(202)
  })
})

describe('a power box that acknowledges a switch write and does not apply it (derived)', () => {
  it('is uncertain: the driver still shows the old value; the switch is not held and the next write is admitted', async () => {
    const box = 'Pegasus PPBA'

    fake = new FakeIndi()
    await fake.start()
    fake.define(connection(box))
    fake.define({ device: box, name: 'POWER_CHANNELS', kind: 'switch', perm: 'rw', rule: 'AnyOfMany', state: 'Ok', elements: { POWER_CHANNEL_1: { value: true } } })
    addDewHeaters(fake, box)
    fake.behaviour = appliesNothing('POWER_CHANNELS')
    cria = await startCria(fake.port, [{ id: 'switch', kind: 'switch', indiDevice: box, channels: [{ name: '12V', property: 'POWER_CHANNELS', element: 'POWER_CHANNEL_1' }] }], { acknowledgeMs: 600 })
    await cria.waitFor(allReady(['switch']))

    const first = await cria.run('switch', 'switch-set', { channelId: 0, value: 0 })

    expect(first).toMatchObject({ kind: 'uncertain', reason: 'not-confirmed', quarantined: false })
    expect(fake.vector(box, 'POWER_CHANNELS').elements.POWER_CHANNEL_1!.value).toBe(true)
    expect(await held('switch')).toBe(false)
    expect((await cria.submit('switch', 'switch-set', { channelId: 0, value: 1 })).status).toBe(202)
  }, 40_000)
})

describe('a weather device that never answers a connect (derived)', () => {
  it('is uncertain with no acknowledgement and not held; weather has no command except connect', async () => {
    const box = 'Pegasus PPBA'

    fake = new FakeIndi()
    await fake.start()
    fake.define(connection(box, false))
    fake.define({ device: box, name: 'WEATHER_PARAMETERS', kind: 'number', perm: 'ro', state: 'Ok', elements: { WEATHER_TEMPERATURE: { value: 11.5, min: -50, max: 70 } } })
    fake.behaviour = (_fake, vector) => (vector.name === 'CONNECTION' ? 'handled' : 'default')
    cria = await startCria(fake.port, [{ id: 'weather', kind: 'weather', indiDevice: box }], { acknowledgeMs: 600, initializeTimeoutMs: 1500 })
    await cria.waitFor(state => state.devices[0]!.readings.connected!.status === 'fresh')

    const first = await cria.run('weather', 'device-connect', { connected: true })

    expect(first).toMatchObject({ kind: 'uncertain', quarantined: false })
    expect(await held('weather')).toBe(false)
    expect((await cria.submit('weather', 'device-connect', { connected: true })).status).toBe(202)
  }, 40_000)
})
