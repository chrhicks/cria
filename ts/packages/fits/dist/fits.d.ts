/**
 * Image boundary: FITS (what INDI cameras send) to ASCOM ImageBytes v1 (what
 * Vela decodes today). One pass over the pixels; no processing, scaling or
 * debayering, which belong in Vela.
 *
 * FITS stores rows (x fastest), big-endian; ImageBytes stores columns (y
 * fastest), little-endian, behind a 44-byte header. INDI writes row 0 as the
 * first row read from the sensor, the same row ASCOM calls y = 0.
 */
export declare class FitsError extends Error {
    readonly name = "FitsError";
}
export interface ConvertedImage {
    readonly bytes: Buffer;
    readonly width: number;
    readonly height: number;
    /** From DATE-OBS when the driver wrote it. */
    readonly capturedAt?: number;
}
export declare function readFitsHeader(fits: Buffer): {
    cards: Map<string, string>;
    dataStart: number;
};
export declare function fitsToImageBytes(fits: Buffer, expected: {
    readonly width: number;
    readonly height: number;
}): ConvertedImage;
export interface Exposure {
    readonly seconds: number;
    /** Epoch milliseconds the exposure started. */
    readonly startedAt: number;
}
/**
 * A copy of `fits` that says it was exposed for `exposure.seconds` from
 * `exposure.startedAt`: EXPTIME and DATE-OBS are replaced (or added before END),
 * and CHECKSUM and DATASUM are dropped, because neither would match the new
 * header. The data bytes are shared byte for byte. A header that needs more room
 * grows by whole 2880-byte blocks.
 */
export declare function withExposure(fits: Buffer, exposure: Exposure): Buffer;
/**
 * A copy of `fits` whose every pixel equals its first: a frame with no stars
 * and the same size, background and header.
 */
export declare function flattened(fits: Buffer): Buffer;
//# sourceMappingURL=fits.d.ts.map