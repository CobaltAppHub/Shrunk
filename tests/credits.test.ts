import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db";
import { InsufficientCredits, expireDue, getBalance, grant, reserve, settle } from "@/lib/credits";
import { balance, dueExpirations, type Entry } from "@/lib/ledger";
import { CREDIT_COSTS, PLANS, grantExpiry, withdrawalEligible, yearlyCents } from "@/lib/pricing";
import { applyStripeEvent, type Deps, type SideEffect } from "@/lib/stripe-webhook";

// Real Postgres (PGlite) with the real migration: advisory locks and unique keys are exercised for real.
async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  for (const f of readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint")) await pg.exec(stmt);
  }
  return drizzle(pg, { schema }) as unknown as Db;
}

async function seed(db: Db, customer = "cus_1") {
  await db.insert(schema.users).values({ id: "u1", email: "a@example.test" });
  const [ws] = await db.insert(schema.workspaces).values({ name: "ws", ownerId: "u1", stripeCustomerId: customer }).returning();
  return ws!.id;
}

async function newJob(db: Db, workspaceId: string, cost = 1) {
  const [j] = await db.insert(schema.jobs).values({ workspaceId, type: "render", refId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), creditCost: cost }).returning();
  return j!.id;
}

describe("price list (barème)", () => {
  it("matches the spec", () => {
    expect(CREDIT_COSTS).toEqual({ render_hd: 1, voiceover: 1, faceless_video: 3, veo_lite_8s: 5, veo_standard_8s: 30 });
    expect([PLANS.starter.monthlyCents, PLANS.pro.monthlyCents, PLANS.agency.monthlyCents]).toEqual([1500, 2900, 7900]);
    expect([PLANS.starter.monthlyCredits, PLANS.pro.monthlyCredits, PLANS.agency.monthlyCredits]).toEqual([60, 200, 600]);
    expect(PLANS.free).toMatchObject({ monthlyCredits: 3, maxHeight: 720, watermark: true, autoPublish: false });
  });
  it("annual is exactly -20%", () => {
    expect(yearlyCents("starter")).toBe(14400);
    expect(yearlyCents("pro")).toBe(27840);
    expect(yearlyCents("agency")).toBe(75840);
  });
  it("monthly credits expire at the start of M+2", () => {
    expect(grantExpiry(new Date("2026-10-15T12:00:00Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(grantExpiry(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });
  it("withdrawal: 14 days and fewer than 5 renders", () => {
    const start = new Date("2026-10-01T00:00:00Z");
    expect(withdrawalEligible(start, new Date("2026-10-14T00:00:00Z"), 4)).toBe(true);
    expect(withdrawalEligible(start, new Date("2026-10-14T00:00:00Z"), 5)).toBe(false);
    expect(withdrawalEligible(start, new Date("2026-10-16T00:00:00Z"), 0)).toBe(false);
  });
});

describe("ledger math", () => {
  const d = (s: string) => new Date(s);
  it("spends the soonest-expiring credits first and expires only what is left", () => {
    const entries: Entry[] = [
      { id: "pack", delta: 50, kind: "purchase", expiresAt: null },
      { id: "oct", delta: 60, kind: "grant", expiresAt: d("2026-12-01") },
      { id: "nov", delta: 60, kind: "grant", expiresAt: d("2027-01-01") },
      { id: "r1", delta: -40, kind: "reserve", expiresAt: null },
      { id: "c1", delta: 0, kind: "capture", expiresAt: null },
      { id: "r2", delta: -5, kind: "reserve", expiresAt: null },
      { id: "l2", delta: 5, kind: "release", expiresAt: null },
    ];
    expect(balance(entries)).toBe(130);
    expect(dueExpirations(entries, d("2026-11-30"))).toEqual([]);
    expect(dueExpirations(entries, d("2026-12-01"))).toEqual([{ grantId: "oct", amount: 20 }]);
    // Once the expiry is written, nothing more is due for that grant.
    const after = [...entries, { id: "e", delta: -20, kind: "expire" as const, expiresAt: null }];
    expect(dueExpirations(after, d("2026-12-02"))).toEqual([]);
    expect(balance(after)).toBe(110);
  });
  it("packs never expire", () => {
    expect(dueExpirations([{ id: "p", delta: 10, kind: "purchase", expiresAt: null }], d("2100-01-01"))).toEqual([]);
  });
});

describe("credits on Postgres", () => {
  let db: Db;
  let ws: string;
  beforeEach(async () => {
    db = await freshDb();
    ws = await seed(db);
    await grant(db, { workspaceId: ws, amount: 3, key: "g1", reason: "t", expiresAt: null });
  });

  it("reserve is idempotent per job and blocks overdraft", async () => {
    const job = await newJob(db, ws, 2);
    await reserve(db, { workspaceId: ws, jobId: job, cost: 2, reason: "render" });
    await reserve(db, { workspaceId: ws, jobId: job, cost: 2, reason: "render" }); // double click / retry
    expect(await getBalance(db, ws)).toBe(1);
    await expect(reserve(db, { workspaceId: ws, jobId: await newJob(db, ws, 2), cost: 2, reason: "render" })).rejects.toBeInstanceOf(InsufficientCredits);
  });

  it("concurrent reserves never overdraw", async () => {
    const jobsIds = await Promise.all([1, 2, 3, 4, 5].map(() => newJob(db, ws)));
    const results = await Promise.allSettled(jobsIds.map((jobId) => reserve(db, { workspaceId: ws, jobId, cost: 1, reason: "render" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await getBalance(db, ws)).toBe(0);
  });

  it("a job is settled exactly once: never both charged and refunded", async () => {
    const job = await newJob(db, ws, 1);
    await reserve(db, { workspaceId: ws, jobId: job, cost: 1, reason: "render" });
    expect(await settle(db, job, "release")).toBe(true); // timeout sweeper
    expect(await settle(db, job, "capture")).toBe(false); // late success: no charge
    expect(await settle(db, job, "release")).toBe(false); // replay
    expect(await getBalance(db, ws)).toBe(3);
  });

  it("successful render keeps the debit", async () => {
    const job = await newJob(db, ws, 1);
    await reserve(db, { workspaceId: ws, jobId: job, cost: 1, reason: "render" });
    await settle(db, job, "capture");
    await settle(db, job, "release");
    expect(await getBalance(db, ws)).toBe(2);
  });

  it("expireDue writes each expiry once", async () => {
    await grant(db, { workspaceId: ws, amount: 10, key: "g2", reason: "t", expiresAt: new Date("2026-01-01") });
    await expireDue(db, ws, new Date("2026-02-01"));
    await expireDue(db, ws, new Date("2026-02-01"));
    expect(await getBalance(db, ws)).toBe(3);
  });
});

describe("Stripe webhook idempotency", () => {
  let db: Db;
  let ws: string;
  const sent: SideEffect[] = [];
  const deps: Deps = { lookupKeyOf: async () => "pro_month", notify: async (_db, e) => { sent.push(e); } };
  const invoicePaid = (id: string) => ({
    id, type: "invoice.paid",
    data: { object: { id: "in_1", customer: "cus_1", created: Date.UTC(2026, 9, 5) / 1000, parent: { subscription_details: { subscription: "sub_1" } } } },
  }) as unknown as Stripe.Event;

  beforeEach(async () => {
    db = await freshDb();
    ws = await seed(db);
    sent.length = 0;
  });

  it("replaying the same event grants credits once", async () => {
    expect(await applyStripeEvent(db, invoicePaid("evt_1"), deps)).toBe("applied");
    expect(await applyStripeEvent(db, invoicePaid("evt_1"), deps)).toBe("duplicate");
    expect(await getBalance(db, ws)).toBe(200);
  });

  it("two different events for the same month grant once (shared month key)", async () => {
    await applyStripeEvent(db, invoicePaid("evt_1"), deps);
    await applyStripeEvent(db, invoicePaid("evt_2"), deps);
    expect(await getBalance(db, ws)).toBe(200);
  });

  it("a failed event is rolled back so Stripe's retry re-applies it", async () => {
    const failing: Deps = { ...deps, lookupKeyOf: async () => { throw new Error("stripe down"); } };
    await expect(applyStripeEvent(db, invoicePaid("evt_3"), failing)).rejects.toThrow();
    expect(await db.select().from(schema.stripeEvents).where(eq(schema.stripeEvents.id, "evt_3"))).toHaveLength(0);
    expect(await applyStripeEvent(db, invoicePaid("evt_3"), deps)).toBe("applied");
    expect(await getBalance(db, ws)).toBe(200);
  });

  it("pack purchase is credited once and never expires", async () => {
    const evt = { id: "evt_p", type: "checkout.session.completed", data: { object: { id: "cs_1", customer: "cus_1", mode: "payment", payment_status: "paid", metadata: { pack: "pack_50" } } } } as unknown as Stripe.Event;
    await applyStripeEvent(db, evt, deps);
    await applyStripeEvent(db, { ...evt, id: "evt_p2" } as Stripe.Event, deps); // Stripe resends under a new id
    const rows = await db.select().from(schema.creditLedger).where(eq(schema.creditLedger.workspaceId, ws));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 50, kind: "purchase", expiresAt: null });
  });

  it("annual renewal reminder is emitted for yearly plans only", async () => {
    await db.update(schema.workspaces).set({ billingInterval: "year", plan: "pro" }).where(eq(schema.workspaces.id, ws));
    const evt = { id: "evt_u", type: "invoice.upcoming", data: { object: { customer: "cus_1", next_payment_attempt: Date.UTC(2027, 0, 1) / 1000 } } } as unknown as Stripe.Event;
    await applyStripeEvent(db, evt, deps);
    expect(sent).toEqual([{ kind: "annual_renewal_reminder", workspaceId: ws, renewsAt: new Date(Date.UTC(2027, 0, 1)) }]);
  });
});
