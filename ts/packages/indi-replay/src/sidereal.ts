/**
 * Local sidereal time in hours: Greenwich mean sidereal time (IAU 1982) plus
 * the east longitude. The same formula as Cria's mount reading
 * (`apps/cria/src/capability/mount.ts`), kept apart because a package cannot
 * import the service; `testing/replay.test.ts` checks that the two agree.
 */
export function localSiderealHours(epochMs: number, eastLongitudeDegrees: number): number {
  const daysSinceJ2000 = epochMs / 86_400_000 + 2440587.5 - 2451545.0
  const greenwich = 18.697374558 + 24.06570982441908 * daysSinceJ2000
  const local = greenwich + eastLongitudeDegrees / 15

  return ((local % 24) + 24) % 24
}
