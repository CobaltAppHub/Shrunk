import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { memberships, workspaces } from "@/db/schema";
import { grant } from "./credits";
import { PLANS, grantExpiry } from "./pricing";

export async function createPersonalWorkspace(userId: string, name: string) {
  await db.transaction(async (tx) => {
    const [ws] = await tx.insert(workspaces).values({ name, ownerId: userId }).returning();
    await tx.insert(memberships).values({ workspaceId: ws!.id, userId, role: "owner" });
    const now = new Date();
    await grant(tx, {
      workspaceId: ws!.id,
      amount: PLANS.free.monthlyCredits,
      key: `free:${ws!.id}:${now.toISOString().slice(0, 7)}`,
      reason: "free plan monthly credits",
      expiresAt: grantExpiry(now),
    });
  });
}

type Role = "owner" | "editor" | "viewer";
const rank: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** Authorisation gate for every server action: session + CGU + membership with min role. */
export async function requireWorkspace(minRole: Role = "viewer") {
  const { getSession } = await import("./auth");
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!(session.user as { termsAcceptedAt?: Date | null }).termsAcceptedAt) redirect("/terms/accept");
  // ponytail: first membership = active workspace; add a workspace switcher with J6 (teams).
  const [m] = await db
    .select({ ws: workspaces, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, session.user.id)))
    .limit(1);
  if (!m || rank[m.role] < rank[minRole]) throw new Error("forbidden");
  return { user: session.user, workspace: m.ws, role: m.role };
}
