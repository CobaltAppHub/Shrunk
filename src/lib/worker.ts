import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Must match worker/app.py `sign`: hex HMAC-SHA256 of "<timestamp>.<raw body>". */
export function verifyWorkerSignature(secret: string, ts: string | null, sig: string | null, body: string, now = Date.now()): boolean {
  if (!ts || !sig || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (Math.abs(now / 1000 - Number(ts)) > 300) return false; // replay window
  const expected = createHmac("sha256", secret).update(`${ts}.${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(sig, "hex"));
}

export const workerCallback = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("transcribe"),
    ref: z.uuid(),
    ok: z.boolean(),
    error_code: z.string().max(64).optional(),
    duration_s: z.number().positive().optional(),
    language: z.string().max(16).optional(),
    cost_usd: z.number().nullable().optional(),
  }),
  z.object({
    kind: z.literal("previews"),
    ref: z.uuid(),
    ok: z.boolean(),
    done: z.array(z.uuid()).default([]),
    failed: z.array(z.uuid()).default([]),
    cost_usd: z.number().nullable().optional(),
  }),
]);
export type WorkerCallback = z.infer<typeof workerCallback>;

/** Job keys shared by the dispatcher (Inngest) and the callback route. */
export const workerJobKey = (kind: "transcribe" | "previews", assetId: string) => `${kind}:${assetId}`;

export async function submitWorkerJob(baseUrl: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 202) throw new Error(`worker_submit_${res.status}`);
}
