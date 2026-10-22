// Demo/E2E seed: one user, one workspace, credits, and the public-domain demo source.
// Usage: pnpm db:seed   (idempotent: safe to run again)
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { grant } from "@/lib/credits";
import type { Db } from "@/db";

/**
 * Verified 2026-10-22 through the Wikimedia Commons API (imageinfo + extmetadata):
 * licence "Public domain", author NASA's Scientific Visualization Studio, 237.4 s, 32 242 743 bytes,
 * VP8 1920x1080 + Opus audio. Source page: https://svs.gsfc.nasa.gov/14328
 */
export const DEMO = {
  url: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Hubble_Science-_Multiwavelength_Astronomy%2C_The_Big_Picture_%28SVS14328%29.webm",
  bytes: 32_242_743,
  durationS: 237.384,
  license: "Public domain — NASA Scientific Visualization Studio, SVS 14328 (Wikimedia Commons)",
  credit: "NASA's Scientific Visualization Studio",
} as const;

export const E2E_USER = { id: "e2e-user", email: "e2e@shrunk.test", name: "E2E" };

export async function seedDemo(db: PostgresJsDatabase<typeof schema>) {
  await db.insert(schema.users)
    .values({ ...E2E_USER, emailVerified: true, termsAcceptedAt: new Date(), termsVersion: "e2e" })
    .onConflictDoNothing();
  let [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.ownerId, E2E_USER.id));
  if (!ws) {
    // Agency quotas so repeated E2E runs do not hit the free plan's 5 imports / month.
    [ws] = await db.insert(schema.workspaces).values({ name: "E2E", ownerId: E2E_USER.id, plan: "agency" }).returning();
    await db.insert(schema.memberships).values({ workspaceId: ws!.id, userId: E2E_USER.id, role: "owner" });
  }
  await grant(db as unknown as Db, { workspaceId: ws!.id, amount: 10, key: `seed:${ws!.id}`, reason: "e2e seed", expiresAt: null });
  return { userId: E2E_USER.id, workspace: { id: ws!.id, plan: ws!.plan } };
}

// `pnpm db:seed`
if (process.argv[1]?.endsWith("seed.ts")) {
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  try { process.loadEnvFile(".env.local"); } catch { /* env from the shell */ }
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const out = await seedDemo(drizzle(sql, { schema }));
  console.log(`seeded workspace ${out.workspace.id} (${out.workspace.plan}) for ${E2E_USER.email}`);
  await sql.end();
}
