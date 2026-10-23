// Demo/E2E seed: one user, one workspace, credits, and the public-domain demo source.
// Usage: pnpm db:seed   (idempotent: safe to run again)
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { grant } from "@/lib/credits";
import { DEMO } from "@/lib/demo";
import type { Db } from "@/db";

// The DEMO constant now lives in src/lib/demo.ts so the public landing can reuse it.
export { DEMO };

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
