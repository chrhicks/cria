import type { ReadingsOf } from '@cria/wire'
import { angularDelta, type Position } from './stopped.js'

type PierSide = Extract<ReadingsOf<'mount'>['pierSide'], { readonly status: 'fresh' }>['value']

export interface SidedPosition extends Position {
  readonly pierSide: PierSide
}

export function axisDelta({ from, to }: { readonly from: SidedPosition; readonly to: SidedPosition }): { readonly raDegrees: number; readonly decDegrees: number } {
  const changedSide = from.pierSide !== 'unknown' && to.pierSide !== 'unknown' && from.pierSide !== to.pierSide

  return {
    raDegrees: angularDelta(to.ra, from.ra + (changedSide ? 180 : 0)),
    decDegrees: changedSide ? angularDelta(to.dec, 180 - from.dec) : to.dec - from.dec,
  }
}
