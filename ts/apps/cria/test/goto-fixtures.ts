import { readFileSync } from 'node:fs'
import { Schema } from 'effect'

const Pose = Schema.Struct({ hourAngleDegrees: Schema.Number, declinationDegrees: Schema.Number, pierSide: Schema.Literals(['east', 'west']) })
export const recordedGotos = Schema.decodeUnknownSync(Schema.Struct({
  flips: Schema.Array(Schema.Struct({ from: Pose, target: Pose, poses: Schema.Array(Pose) })),
  nearPoleEndpoints: Schema.Array(Schema.Struct({ from: Pose, target: Pose, observed: Pose })),
}), { onExcessProperty: 'error' })(JSON.parse(readFileSync(new URL('./fixtures/goto-poses.json', import.meta.url), 'utf8')))


export type RecordedGoto = (typeof recordedGotos.flips)[number]
