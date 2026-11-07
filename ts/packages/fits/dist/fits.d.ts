/**
 * Image boundary: the FITS header INDI cameras write. Cria serves the frame as
 * the camera delivered it and reads only the header.
 */
export declare class FitsError extends Error {
    readonly name = "FitsError";
}
export declare function readFitsHeader(fits: Buffer): {
    cards: Map<string, string>;
    dataStart: number;
};
export declare function readFitsCards(fits: Buffer): ReadonlyArray<string>;
export declare function startedAt(cards: Map<string, string>): number | undefined;
//# sourceMappingURL=fits.d.ts.map