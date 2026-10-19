/**
 * The focuser travel window against errai's EAF on the fake INDI server: the
 * driver's FOCUS_MAX (100000) disagrees with the position's own maximum
 * (60000), and the tube's safe travel (15500 to 38000, chosen by Chris on
 * 2026-10-15) is narrower than both. Cria reports the usable window and
 * refuses a target outside it before sending anything.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FakeIndi } from '@cria/fake-indi'
import { addEaf } from './drivers.js'
import { allReady, noneNotRead, startCria, until, valueOf, type Cria } from './harness.js'

const eaf = 'ZWO EAF'
const travel = { min: 15500, max: 38000 }
let fake: FakeIndi
let cria: Cria

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

async function start(options: { position?: number; travel?: { min: number; max: number } } = {}) {
  fake = new FakeIndi()
  await fake.start()
  fake.behaviour = addEaf(fake, eaf, { position: options.position })
  cria = await startCria(fake.port, [{ id: 'focuser', kind: 'focuser', indiDevice: eaf, ...(options.travel && { travel: options.travel }) }])
  await cria.waitFor(allReady(['focuser']))
  await cria.waitFor(noneNotRead)
}

const moves = () => fake.received.filter(xml => xml.startsWith('<new') && xml.includes('name="ABS_FOCUS_POSITION"'))
const move = (position: number) => cria.run('focuser', 'focuser-move', { position, minPosition: 1, maxPosition: 200_000 })
const window = async () => {
  const focuser = await cria.device('focuser')

  return [valueOf(focuser, 'minStep'), valueOf(focuser, 'maxStep')]
}

describe('an EAF whose FOCUS_MAX is past its position range, no travel configured', () => {
  it("reports the position's own range, not FOCUS_MAX", async () => {
    await start()

    expect(await window()).toEqual([0, 60000])
  })

  it('refuses a target past the position range before sending, instead of letting the driver refuse it', async () => {
    await start()

    const refused = await move(70000)

    expect([refused.kind, refused.reason, refused.message]).toEqual(['failed', 'invalid', 'Focuser target approaches the mechanical limit'])
    expect(moves()).toEqual([])
  })

  it('still moves after the driver refused a move (Alert on the position)', async () => {
    await start()
    // A one-step change marks the Alert update, so the test can see Cria has it.
    fake.update(eaf, 'ABS_FOCUS_POSITION', { state: 'Alert', values: { FOCUS_ABSOLUTE_POSITION: 32750 } })
    await until('the Alert update to reach Cria', async () => valueOf(await cria.device('focuser'), 'position') === 32750)

    const after = await move(20000)

    expect([after.kind, after.reason, after.message, after.values]).toEqual(['confirmed', null, null, { position: 20000 }])
  })
})

describe('an EAF with a travel window', () => {
  it('reports the window as minStep and maxStep', async () => {
    await start({ travel })

    expect(await window()).toEqual([15500, 38000])
  })

  it('refuses a target past either end before sending, naming the window and the target', async () => {
    await start({ travel })

    const high = await move(38001)
    const low = await move(15499)

    expect([high.kind, high.reason, high.message]).toEqual(['failed', 'invalid', 'Focuser target 38001 is outside the travel window 15500..38000'])
    expect([low.kind, low.reason, low.message]).toEqual(['failed', 'invalid', 'Focuser target 15499 is outside the travel window 15500..38000'])
    expect(moves()).toEqual([])
  })

  it('moves to either end of the window', async () => {
    await start({ travel })

    expect(await move(38000)).toMatchObject({ kind: 'confirmed', values: { position: 38000 } })
    expect(await move(15500)).toMatchObject({ kind: 'confirmed', values: { position: 15500 } })
  })
})

describe('an EAF that stands outside its travel window', () => {
  it('below it: moves toward the window, refuses a move away from it or past its far end', async () => {
    await start({ travel, position: 10000 })

    const away = await move(9000)
    const past = await move(38001)

    expect([away.kind, away.reason, away.message]).toEqual([
      'failed',
      'invalid',
      'Focuser target 9000 is outside the travel window 15500..38000 and the focuser is at 10000: only a move toward the window is allowed',
    ])
    expect([past.kind, past.reason]).toEqual(['failed', 'invalid'])
    expect(moves()).toEqual([])
    expect(await move(12000)).toMatchObject({ kind: 'confirmed', values: { position: 12000 } })
    expect(await move(20000)).toMatchObject({ kind: 'confirmed', values: { position: 20000 } })
  })

  it('above it: moves toward the window, refuses a move away from it', async () => {
    await start({ travel, position: 45000 })

    const away = await move(46000)

    expect([away.kind, away.reason, away.message]).toEqual([
      'failed',
      'invalid',
      'Focuser target 46000 is outside the travel window 15500..38000 and the focuser is at 45000: only a move toward the window is allowed',
    ])
    expect(moves()).toEqual([])
    expect(await move(40000)).toMatchObject({ kind: 'confirmed', values: { position: 40000 } })
  })

  it('halts', async () => {
    await start({ travel, position: 45000 })

    expect(await cria.run('focuser', 'focuser-halt', {})).toMatchObject({ kind: 'confirmed', values: { position: 45000 } })
  })
})
