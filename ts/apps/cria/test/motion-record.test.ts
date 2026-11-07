import { afterEach, expect, it } from 'vitest'
import { FakeIndi, addMount } from '@cria/fake-indi'
import { allReady, startCria, type Cria } from './harness.js'

let fake: FakeIndi
let cria: Cria

afterEach(async () => {
  await cria?.stop()
  await fake?.stop()
})

it('keeps home and standalone stop records in the state snapshot', async () => {
  fake = new FakeIndi()
  await fake.start()
  addMount(fake, 'Fake mount')
  cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: 'Fake mount', motion: { positionReadMs: 250 } }])
  await cria.waitFor(allReady(['mount']))

  for (const [kind, how] of [['mount-home', 'arrived'], ['mount-stop', 'aborted']] as const) {
    const ended = await cria.run('mount', kind, {})

    expect(ended.operation.motion).toMatchObject({
      commanded: { kind: kind === 'mount-home' ? 'home' : 'stop' },
      observed: { from: { rightAscensionDegrees: 30, declinationDegrees: 40 }, to: { rightAscensionDegrees: 30, declinationDegrees: 40 }, travel: { rightAscensionDegrees: 0, declinationDegrees: 0 } },
      stopped: { how },
    })
    expect((await cria.state()).operations.find(operation => operation.id === ended.id)).toEqual(ended.operation)
  }
})
