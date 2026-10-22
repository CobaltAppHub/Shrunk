import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

// ── Transcript shape written by worker/transcribe.py ─────────────────────────
export type Word = { w: string; s: number; e: number; sp?: string };
export type Segment = { s: number; e: number; t: string; sp?: string | null; words: Word[] };
export type Transcript = { language: string; segments: Segment[] };

export type Window = { start: number; end: number; text: string };

/** 60-90 s windows on segment boundaries, overlapping 15 s so a moment cut by a boundary is still seen whole. */
export function windows(segments: Segment[], target = 75, max = 90, overlap = 15): Window[] {
  const out: Window[] = [];
  let i = 0;
  while (i < segments.length) {
    const first = segments[i]!;
    let j = i;
    while (j + 1 < segments.length && segments[j + 1]!.e - first.s <= max && segments[j]!.e - first.s < target) j++;
    const slice = segments.slice(i, j + 1);
    out.push({
      start: first.s,
      end: slice.at(-1)!.e,
      text: slice.map((s) => `[${s.s.toFixed(1)}]${s.sp ? ` ${s.sp}:` : ""} ${s.t}`).join("\n"),
    });
    if (j + 1 >= segments.length) break;
    const restart = slice.at(-1)!.e - overlap;
    let k = j + 1;
    while (k - 1 > i && segments[k - 1]!.s >= restart) k--; // step back for the overlap
    i = k;
  }
  return out;
}

// ── LLM contract ─────────────────────────────────────────────────────────────
const criterion = z.object({ score: z.number(), reason: z.string() });
export const llmOutput = z.object({
  candidates: z.array(z.object({
    start: z.number(),
    end: z.number(),
    hook: z.string(),
    title: z.string(),
    hashtags: z.array(z.string()),
    scores: z.object({ hook: criterion, standalone: criterion, emotion: criterion, pace: criterion }),
  })),
});
export type LlmCandidate = z.infer<typeof llmOutput>["candidates"][number];

export type Candidate = {
  startS: number;
  endS: number;
  hook: string;
  title: string;
  hashtags: string[];
  score: number; // 0-100
  scoreReasons: Record<"hook" | "standalone" | "emotion" | "pace", { score: number; reason: string }> & { duration: { score: number; seconds: number } };
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Deterministic, not asked to the model: 20 pts inside 20-45 s, falling to 0 at 10 s and 90 s. */
export function durationScore(d: number): number {
  if (d >= 20 && d <= 45) return 20;
  if (d < 20) return Math.round(clamp((d - 10) / 10, 0, 1) * 20);
  return Math.round(clamp((90 - d) / 45, 0, 1) * 20);
}

/** Snap model timestamps onto real word boundaries so a clip never starts or ends mid-word. */
export function snap(start: number, end: number, words: Word[]): { start: number; end: number } | null {
  const first = words.find((w) => w.s >= start - 0.5);
  const last = [...words].reverse().find((w) => w.e <= end + 0.5);
  if (!first || !last || last.e <= first.s) return null;
  return { start: first.s, end: last.e };
}

export function toCandidate(c: LlmCandidate, win: Window, words: Word[]): Candidate | null {
  if (c.start < win.start - 2 || c.end > win.end + 2) return null; // invented timestamps
  const t = snap(c.start, c.end, words.filter((w) => w.s >= win.start - 2 && w.e <= win.end + 2));
  if (!t) return null;
  const d = t.end - t.start;
  if (d < 10 || d > 90) return null;
  const crit = (k: keyof LlmCandidate["scores"]) => ({ score: clamp(Math.round(c.scores[k].score), 0, 20), reason: c.scores[k].reason.slice(0, 300) });
  const reasons = { hook: crit("hook"), standalone: crit("standalone"), emotion: crit("emotion"), pace: crit("pace"), duration: { score: durationScore(d), seconds: Math.round(d) } };
  return {
    startS: t.start,
    endS: t.end,
    hook: c.hook.slice(0, 200),
    title: c.title.slice(0, 120),
    hashtags: c.hashtags.map((h) => h.replace(/^#?/, "#").replace(/\s+/g, "")).filter((h) => h.length > 1).slice(0, 5),
    score: reasons.hook.score + reasons.standalone.score + reasons.emotion.score + reasons.pace.score + reasons.duration.score,
    scoreReasons: reasons,
  };
}

const iou = (a: Candidate, b: Candidate) => {
  const inter = Math.max(0, Math.min(a.endS, b.endS) - Math.max(a.startS, b.startS));
  return inter / (Math.max(a.endS, b.endS) - Math.min(a.startS, b.startS));
};

/** Best first; drops near-duplicates from overlapping windows; keeps at most `limit`. */
export function dedupe(cands: Candidate[], limit = 30): Candidate[] {
  const kept: Candidate[] = [];
  for (const c of [...cands].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k, c) < 0.5)) kept.push(c);
    if (kept.length === limit) break;
  }
  return kept;
}

// ── Claude call ──────────────────────────────────────────────────────────────
export const MODEL = "claude-sonnet-5-5";
const USD_PER_MTOK = { input: 2, output: 10 }; // claude-sonnet-5-5 list price, 2026-10

const SYSTEM = `You select moments from a long video that work as standalone short-form clips (TikTok, Reels, Shorts).
You receive one excerpt of a timestamped transcript. Lines start with [seconds].
Return 0 to 3 candidates from this excerpt only. Returning none is correct when nothing stands alone.
For each candidate:
- start/end in seconds, taken from the transcript timestamps; 15 to 60 seconds long, ideally 20 to 45.
- Score four criteria from 0 to 20 and give one short sentence explaining each score:
  hook: do the first 3 seconds make a viewer stop scrolling?
  standalone: is it understandable without the rest of the video?
  emotion: humour, surprise, tension, conviction or a strong opinion.
  pace: dense, no long pauses or filler.
- hook: an on-screen hook line (max 12 words); title: a post title (max 70 characters); hashtags: up to 5.
Write reasons, hook, title and hashtags in the transcript's language. Be strict: most moments are not 15+.
Never invent content that is not in the transcript.`;

export async function selectClips(
  client: Anthropic,
  transcript: Transcript,
  opts: { concurrency?: number; limit?: number } = {},
): Promise<{ candidates: Candidate[]; costUsd: number }> {
  const words = transcript.segments.flatMap((s) => s.words);
  const wins = windows(transcript.segments);
  const all: Candidate[] = [];
  let inTok = 0;
  let outTok = 0;

  const run = async (win: Window) => {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(llmOutput) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Language: ${transcript.language}\nExcerpt ${win.start.toFixed(0)}s-${win.end.toFixed(0)}s:\n${win.text}` }],
    });
    inTok += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) * 0.1 + (res.usage.cache_creation_input_tokens ?? 0) * 1.25;
    outTok += res.usage.output_tokens;
    if (res.stop_reason === "refusal" || !res.parsed_output) return; // window skipped, never faked
    for (const c of res.parsed_output.candidates) {
      const cand = toCandidate(c, win, words);
      if (cand) all.push(cand);
    }
  };

  // ponytail: in-process pool; move to the Batches API (-50 %) if analysis latency is not a concern.
  const queue = [...wins];
  await Promise.all(Array.from({ length: opts.concurrency ?? 6 }, async () => {
    for (let w = queue.shift(); w; w = queue.shift()) await run(w);
  }));

  const costUsd = (inTok * USD_PER_MTOK.input + outTok * USD_PER_MTOK.output) / 1e6;
  return { candidates: dedupe(all, opts.limit ?? 30), costUsd: Math.round(costUsd * 10_000) / 10_000 };
}
