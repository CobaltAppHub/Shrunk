// Pure ledger math, no I/O — everything that decides money lives here and is unit-tested.
export type LedgerKind = "grant" | "reserve" | "capture" | "release" | "refund" | "purchase" | "expire";
export type Entry = { id: string; delta: number; kind: LedgerKind; expiresAt: Date | null };

export const balance = (entries: Pick<Entry, "delta">[]) => entries.reduce((s, e) => s + e.delta, 0);

/**
 * Credits to expire now, per grant. Spending consumes the soonest-expiring bucket first
 * (packs, with no expiry, last), so users always lose as little as possible.
 */
export function dueExpirations(entries: Entry[], now: Date): { grantId: string; amount: number }[] {
  const buckets = entries
    .filter((e) => e.kind === "grant" || e.kind === "purchase")
    .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
  // Net consumption: reserves/expires/refunds are negative, releases positive, captures 0.
  let spent = -balance(entries.filter((e) => e.kind !== "grant" && e.kind !== "purchase"));
  const out: { grantId: string; amount: number }[] = [];
  for (const b of buckets) {
    const used = Math.min(Math.max(spent, 0), b.delta);
    spent -= used;
    const left = b.delta - used;
    if (left > 0 && b.expiresAt && b.expiresAt <= now) out.push({ grantId: b.id, amount: left });
  }
  return out;
}
