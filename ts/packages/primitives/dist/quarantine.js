/** Held from the first uncertain ending since the last recovery, oldest first. */
export function quarantineOf(sinceRecovery) {
    for (const ending of sinceRecovery)
        if (ending.outcome.kind === 'uncertain')
            return { held: true, reason: ending.outcome.message, since: ending.settledAt };
    return { held: false };
}
//# sourceMappingURL=quarantine.js.map