import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { env } from "@/lib/env";
import { verifyWorkerSignature, workerCallback, workerJobKey } from "@/lib/worker";
import { inngest } from "@/inngest/client";

export async function POST(req: Request) {
  const body = await req.text();
  if (!verifyWorkerSignature(env.WORKER_CALLBACK_SECRET, req.headers.get("x-shrunk-timestamp"), req.headers.get("x-shrunk-signature"), body)) {
    return new Response("unauthorized", { status: 401 });
  }
  const parsed = workerCallback.safeParse(JSON.parse(body));
  if (!parsed.success) return new Response("bad payload", { status: 400 });
  const cb = parsed.data;
  const key = workerJobKey(cb.kind, cb.ref);

  // Persist first: the pipeline reads the job row, the event only wakes it up early.
  // Only a running job can be settled, so a replayed callback changes nothing.
  await db.update(jobs).set({
    status: cb.ok ? "succeeded" : "failed",
    error: cb.ok ? null : ("error_code" in cb ? cb.error_code ?? "worker_failed" : "worker_failed"),
    result: cb,
    costUsd: cb.cost_usd != null ? String(cb.cost_usd) : null,
    finishedAt: new Date(),
  }).where(and(eq(jobs.idempotencyKey, key), eq(jobs.status, "running")));

  await inngest.send({ name: "worker/done", data: { key } });
  return Response.json({ ok: true });
}
