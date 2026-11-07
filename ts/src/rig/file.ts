import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseConfig, type RigConfig } from './config.ts'

export const defaultRigFile = join(homedir(), '.config/cria/rig.json')

export const readRigFile = (path: string): RigConfig => parseConfig(JSON.parse(readFileSync(path, 'utf8')), { runtimeDir: process.env.XDG_RUNTIME_DIR })

export const wireIdsOf = (config: RigConfig): Readonly<Record<string, string>> => Object.fromEntries(config.devices.map(device => [device.indiDevice, device.id]))
