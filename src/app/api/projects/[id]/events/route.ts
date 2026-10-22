import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { memberships, projects } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isTerminal } from "@/lib/pipeline";

export const maxDuration = 300;

/** SSE stream of the project's real state. Polls Postgres every 2 s; the browser reconnects after 5 min. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("not found", { status: 404 });

  // Same 404 for "missing" and "other workspace": no existence leak across tenants.
  const read = async () => {
    const [p] = await db.select({ status: projects.status, stage: projects.stage, errorCode: projects.errorCode })
      .from(projects)
      .innerJoin(memberships, and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, session.user.id)))
      .where(eq(projects.id, id.data));
    return p;
  };
  if (!(await read())) return new Response("not found", { status: 404 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      let last = "";
      const deadline = Date.now() + 280_000;
      while (!req.signal.aborted && Date.now() < deadline) {
        const p = await read();
        if (!p) break;
        const json = JSON.stringify(p);
        if (json !== last) ctrl.enqueue(enc.encode(`data: ${json}\n\n`));
        last = json;
        if (isTerminal(p.status)) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
