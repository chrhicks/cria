import { FakeIndi, addCamera, addMount } from '@cria/fake-indi'
import { startCria, propertyOf, until, type DeviceSpec } from '../../apps/cria/test/harness.js'
import { makeCriaClient, type CriaClient } from '../cria-client.js'
import { failedStep, recordingFetch, type Recorded } from './golden.js'

const camera = 'Fake CCD'
const mount = 'ZWO AM5'
const site = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

const devices: ReadonlyArray<DeviceSpec> = [
  { id: 'camera', kind: 'camera', indiDevice: camera },
  { id: 'mount', kind: 'mount', indiDevice: mount, site },
]

export interface Scenario {
  readonly name: string
  readonly run: (wire: CriaClient) => Promise<void>
}

export const scenarios: ReadonlyArray<Scenario> = [
  {
    name: 'health',
    run: async wire => {
      await wire.health()
    },
  },
  {
    name: 'connect a camera and a mount',
    run: async wire => {
      await wire.connect({ deviceId: 'camera', connected: true })
      await wire.connect({ deviceId: 'mount', connected: true })
      await wire.connect({ deviceId: 'camera', connected: false })
    },
  },
  {
    name: 'refused requests',
    run: async wire => {
      await wire.connect({ deviceId: 'nothing', connected: true })
      await wire.connect({ deviceId: 'a b', connected: true })
    },
  },
]

export async function runScenario(scenario: Scenario): Promise<Recorded[]> {
  const fake = new FakeIndi()

  await fake.start()
  addCamera(fake, camera, { width: 8, height: 6, upload: 'local' })
  addMount(fake, mount)
  for (const device of [camera, mount]) fake.update(device, 'CONNECTION', { values: { CONNECT: false, DISCONNECT: true } })

  const cria = await startCria(fake.port, devices)
  const recorded: Recorded[] = []

  try {
    await until('Cria to see every device', () => devices.every(device => propertyOf(cria, device.indiDevice, 'CONNECTION') !== undefined))
    await scenario.run(makeCriaClient(cria.base, recordingFetch(recorded)))
  } catch (error) {
    recorded.push({ request: failedStep, status: 0, body: error instanceof Error ? error.message : String(error) })
  } finally {
    await cria.stop()
    await fake.stop()
  }

  return recorded
}
