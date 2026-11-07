import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RigDevice } from './config.ts'

export function usbAttached(vidPid: string, sysfs = '/sys/bus/usb/devices'): boolean {
  const [vendor, product] = vidPid.toLowerCase().split(':')
  const read = (entry: string, file: string) => {
    try {
      return readFileSync(join(sysfs, entry, file), 'utf8').trim().toLowerCase()
    } catch {
      return undefined
    }
  }

  try {
    return readdirSync(sysfs).some(entry => read(entry, 'idVendor') === vendor && read(entry, 'idProduct') === product)
  } catch {
    return false
  }
}

export const hardwarePresent = (device: RigDevice): boolean => (device.usb ? usbAttached(device.usb) : existsSync(device.serial ?? ''))
