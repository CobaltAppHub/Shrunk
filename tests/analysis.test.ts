import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  dedupe, durationScore, llmOutput, selectClips, snap, toCandidate, windows,
  type Candidate, type LlmCandidate, type Segment, type Transcript,
} from "@/lib/clip-selection";
import { pipelineSteps } from "@/lib/pipeline";
import { verifyWorkerSignature } from "@/lib/worker";

// 10 minutes of speech: one 6 s segment of 3 words every 6 s.
const segs: Segment[] = Array.from({ length: 100 }, (_, i) => ({
  s: i * 6, e: i * 6 + 5.5, t: `phrase ${i}`, sp: "SPEAKER_00",
  words: [0, 1, 2].map((k) => ({ w: `w${i}.${k}`, s: i * 6 + k * 2, e: i * 6 + k * 2 + 1.5 })),
}));
const words = segs.flatMap((s) => s.words);
const scores = (n: number) => ({ hook: { score: n, reason: "r" }, standalone: { score: n, reason: "r" }, emotion: { score: n, reason: "r" }, pace: { score: n, reason: "r" } });
const llm = (start: number, end: number, n = 15): LlmCandidate => ({ start, end, hook: "h", title: "t", hashtags: ["ia", "#Tips ", "#"], scores: scores(n) });

describe("windows", () => {
  const w = windows(segs);
  it("are 60-90 s long, cover the whole transcript and overlap", () => {
    for (const x of w.slice(0, -1)) expect(x.end - x.start).toBeGreaterThanOrEqual(60);
    for (const x of w) expect(x.end - x.start).toBeLessThanOrEqual(90);
    expect(w[0]!.start).toBe(0);
    expect(w.at(-1)!.end).toBe(segs.at(-1)!.e);
    for (let i = 1; i < w.length; i++) expect(w[i]!.start).toBeLessThan(w[i - 1]!.end);
  });
  it("carry timestamps and speakers for the model", () => expect(w[0]!.text.split("\n")[1]).toBe("[6.0] SPEAKER_00: phrase 1"));
  it("terminate on a single segment", () => expect(windows(segs.slice(0, 1))).toHaveLength(1));
});

describe("scoring", () => {
  it("duration: 20 inside 20-45 s, 0 at 10 s and 90 s", () => {
    expect([durationScore(20), durationScore(45), durationScore(10), durationScore(90), durationScore(15)]).toEqual([20, 20, 0, 0, 10]);
  });
  it("snaps onto word boundaries", () => expect(snap(12.7, 41, words)).toEqual({ start: 14, end: 41.5 }));

  const win = { start: 0, end: 90, text: "" };
  it("builds a 0-100 score from four model criteria plus computed duration", () => {
    const c = toCandidate(llm(12, 42, 15), win, words)!;
    expect(c.score).toBe(15 * 4 + 20);
    expect(c.scoreReasons.duration).toEqual({ score: 20, seconds: 30 });
    expect(c.hashtags).toEqual(["#ia", "#Tips"]);
  });
  it("clamps model scores to 0-20", () => expect(toCandidate(llm(12, 42, 99), win, words)!.score).toBe(100));
  it("rejects timestamps outside the window and clips shorter than 10 s", () => {
    expect(toCandidate(llm(80, 140), win, words)).toBeNull();
    expect(toCandidate(llm(12, 18), win, words)).toBeNull();
  });
  it("dedupe keeps the best of overlapping candidates", () => {
    const mk = (s: number, e: number, score: number) => ({ startS: s, endS: e, score }) as Candidate;
    const kept = dedupe([mk(0, 30, 50), mk(5, 32, 80), mk(100, 130, 60)]);
    expect(kept.map((k) => k.score)).toEqual([80, 60]);
    expect(dedupe(Array.from({ length: 50 }, (_, i) => mk(i * 100, i * 100 + 30, i)), 30)).toHaveLength(30);
  });
  it("the model contract rejects malformed output", () => {
    expect(llmOutput.safeParse({ candidates: [{ start: "12", end: 40 }] }).success).toBe(false);
  });
});

describe("selectClips (fake Claude client)", () => {
  const transcript: Transcript = { language: "fr", segments: segs };
  const fake = (respond: (i: number) => object) => {
    let i = 0;
    return { beta: { messages: { parse: async () => respond(i++) } } } as unknown as Anthropic;
  };
  const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  it("skips refused or unparsable windows instead of inventing clips, and prices tokens", async () => {
    const client = fake((i) => i === 0
      ? { stop_reason: "refusal", parsed_output: null, usage }
      : { stop_reason: "end_turn", parsed_output: null, usage });
    const r = await selectClips(client, transcript, { concurrency: 2 });
    expect(r.candidates).toEqual([]);
    const n = windows(segs).length;
    expect(r.costUsd).toBeCloseTo((n * 1000 * 2 + n * 200 * 10) / 1e6, 4);
  });

  it("keeps valid candidates from every window", async () => {
    const wins = windows(segs);
    const client = fake((i) => ({ stop_reason: "end_turn", usage, parsed_output: { candidates: [llm(wins[i]!.start + 2, wins[i]!.start + 32, 10 + (i % 10))] } }));
    const r = await selectClips(client, transcript);
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c, i, a) => i === 0 || a[i - 1]!.score >= c.score)).toBe(true);
  });
});

describe("worker callback signature", () => {
  const secret = "secret-secret-secret-secret-secret";
  const body = '{"kind": "previews"}';
  // Vector produced by worker/app.py `sign` (Python hmac): both sides must agree byte for byte.
  const pySig = "158d823531698a014cdcdd542072d74c4934d60dfd230ac1ed9177aa619a44a1";
  const now = 1_700_000_000_000;
  it("accepts the Python signature", () => expect(verifyWorkerSignature(secret, "1700000000", pySig, body, now)).toBe(true));
  it("rejects a tampered body, a wrong secret and a stale timestamp", () => {
    expect(verifyWorkerSignature(secret, "1700000000", pySig, body + " ", now)).toBe(false);
    expect(verifyWorkerSignature("x".repeat(34), "1700000000", pySig, body, now)).toBe(false);
    expect(verifyWorkerSignature(secret, "1700000000", pySig, body, now + 301_000)).toBe(false);
    expect(verifyWorkerSignature(secret, null, pySig, body, now)).toBe(false);
  });
});

describe("pipeline steps shown to the user", () => {
  it("follows the real stage", () => {
    expect(pipelineSteps("importing", "import")).toEqual({ check: "done", import: "active", transcribe: "pending", select: "pending", preview: "pending" });
    expect(pipelineSteps("analyzing", "select")).toMatchObject({ transcribe: "done", select: "active", preview: "pending" });
    expect(pipelineSteps("ready", null)).toMatchObject({ preview: "done" });
  });
  it("marks the step that failed", () => {
    expect(pipelineSteps("failed", "import")).toMatchObject({ import: "failed", transcribe: "pending" });
    expect(pipelineSteps("failed", "transcribe")).toMatchObject({ import: "done", transcribe: "failed" });
  });
});
