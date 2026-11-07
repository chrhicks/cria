import { Effect, Option } from 'effect'
import type { IndiDevice } from '../src/indi/index.ts'

export const propertyOf = (device: IndiDevice, name: string) =>
  Effect.map(device.properties, properties => Option.fromNullishOr(properties.find(property => property.name === name)))
