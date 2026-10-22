import { and, eq, sql } from "drizzle-orm";
import { creditLedger, jobs } from "@/db/schema";
import type { Db, Tx } from "@/db";
import { dueExpirations, type Entry } from "./ledger";

export class InsufficientCredits extends Error {
  constructor(public needed: number, public available: number) {
    super(`insufficient_credits: need ${needed}, have ${available}`);
  }
}

// Serialises all ledger writes of one workspace inside the current transaction.
const lockWorkspace = (tx: Tx, workspaceId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`);

export async function getBalance(db: Db | Tx, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
    .from(creditLedger)
    .where(eq(creditLedger.workspaceId, workspaceId));
  return row?.total ?? 0;
}

type Insert = typeof creditLedger.$inferInsert;
// Every write is keyed: replaying a webhook or a job step is a no-op.
const write = (tx: Db | Tx, row: Insert) =>
  tx.insert(creditLedger).values(row).onConflictDoNothing({ target: creditLedger.idempotencyKey }).returning();

export function grant(db: Db | Tx, p: { workspaceId: string; amount: number; key: string; reason: string; expiresAt: Date | null; kind?: "grant" | "purchase" }) {
  return write(db, { workspaceId: p.workspaceId, delta: p.amount, kind: p.kind ?? "grant", idempotencyKey: p.key, reason: p.reason, expiresAt: p.expiresAt });
}

/** Hold credits for a job. Idempotent per job; throws if the balance is too low. */
export async function reserve(db: Db, p: { workspaceId: string; jobId: string; cost: number; reason: string }) {
  if (p.cost <= 0) return;
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, p.workspaceId);
    const [existing] = await tx.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, `reserve:${p.jobId}`));
    if (existing) return;
    const available = await getBalance(tx, p.workspaceId);
    if (available < p.cost) throw new InsufficientCredits(p.cost, available);
    await write(tx, { workspaceId: p.workspaceId, jobId: p.jobId, delta: -p.cost, kind: "reserve", idempotencyKey: `reserve:${p.jobId}`, reason: p.reason });
  });
}

/**
 * Settle a reservation exactly once. capture and release share the key `settle:<job>`,
 * so the unique index guarantees a job is never both charged and refunded.
 * Returns true if this call did the settling.
 */
export async function settle(db: Db | Tx, jobId: string, outcome: "capture" | "release"): Promise<boolean> {
  const [reservation] = await db.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, `reserve:${jobId}`));
  if (!reservation) return false;
  const rows = await write(db, {
    workspaceId: reservation.workspaceId,
    jobId,
    delta: outcome === "capture" ? 0 : -reservation.delta,
    kind: outcome,
    idempotencyKey: `settle:${jobId}`,
    reason: outcome === "capture" ? "render delivered" : "job failed — credits returned",
  });
  return rows.length > 0;
}

/** Release every reservation of jobs stuck past the timeout. Returns released job ids (for the email). */
export async function releaseTimedOut(db: Db, olderThan: Date): Promise<string[]> {
  const stuck = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), sql`${jobs.startedAt} < ${olderThan}`));
  const released: string[] = [];
  for (const j of stuck) {
    await db.update(jobs).set({ status: "failed", error: "timeout", finishedAt: new Date() }).where(eq(jobs.id, j.id));
    if (await settle(db, j.id, "release")) released.push(j.id);
  }
  return released;
}

export async function expireDue(db: Db, workspaceId: string, now = new Date()) {
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const entries = (await tx.select().from(creditLedger).where(eq(creditLedger.workspaceId, workspaceId))) as Entry[];
    for (const e of dueExpirations(entries, now)) {
      await write(tx, { workspaceId, delta: -e.amount, kind: "expire", idempotencyKey: `expire:${e.grantId}`, reason: "monthly credits expired" });
    }
  });
}
