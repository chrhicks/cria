/**
 * A 16-bit FITS frame whose pixel (x, y) is `base + x + 10 * y`, with the
 * EXPTIME and DATE-OBS keywords INDI's CCD base class writes.
 */
export declare function fitsFrame(width: number, height: number, frame?: {
    exptime?: number;
    startedAt?: number;
    base?: number;
}): Buffer;
//# sourceMappingURL=frame.d.ts.map