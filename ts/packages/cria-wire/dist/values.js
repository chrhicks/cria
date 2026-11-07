/**
 * View: Outcome as a wire shape. It is the same union as in @cria/primitives;
 * the closed reason lists are imported from there, so they can't drift.
 */
import { Schema } from 'effect';
import { failedReasons, uncertainReasons } from '@cria/primitives';
export const Timestamp = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)));
export const Json = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
export function Outcome(value) {
    return Schema.Union([
        Schema.Struct({ kind: Schema.Literal('confirmed'), value }),
        Schema.Struct({ kind: Schema.Literal('failed'), reason: Schema.Literals(failedReasons), message: Schema.String }),
        Schema.Struct({ kind: Schema.Literal('stopped') }),
        Schema.Struct({ kind: Schema.Literal('uncertain'), reason: Schema.Literals(uncertainReasons), message: Schema.String }),
    ]);
}
//# sourceMappingURL=values.js.map