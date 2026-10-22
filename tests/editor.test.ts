import { describe, expect, it } from "vitest";
import { defaultEditState, editState, renderPayload, renderSpec, validateEdit } from "@/lib/edit-state";

const words = [
  { w: " avant", s: 8, e: 9.5 },
  { w: "Bonjour", s: 10, e: 10.4 },
  { w: "à", s: 10.5, e: 10.6 },
  { w: "tous", s: 10.7, e: 11 },
  { w: "après", s: 40.5, e: 41 },
];
const clip = { startS: 10, endS: 40 };

describe("edit state", () => {
  const s = defaultEditState(clip, words);

  it("defaults: clip bounds, words inside the clip only, schema-valid, no music", () => {
    expect(s.trim).toEqual({ start: 10, end: 40 });
    expect(s.captions.words.map((w) => w.w)).toEqual(["Bonjour", "à", "tous"]);
    expect(editState.parse(s)).toEqual(s);
    expect(s.music).toBeNull();
  });

  it("server-side trim validation", () => {
    expect(validateEdit(s, { durationS: 100 })).toBeNull();
    expect(validateEdit({ ...s, trim: { start: 10, end: 12 } }, { durationS: 100 })).toBe("trim_too_short");
    expect(validateEdit({ ...s, trim: { start: 0, end: 130 } }, { durationS: 200 })).toBe("trim_too_long");
    expect(validateEdit({ ...s, trim: { start: 30, end: 20 } }, { durationS: 100 })).toBe("trim_invalid");
    expect(validateEdit(s, { durationS: 35 })).toBe("trim_invalid");
  });

  it("rejects malformed client input", () => {
    expect(editState.safeParse({ ...s, captions: { ...s.captions, style: { ...s.captions.style, color: "red" } } }).success).toBe(false);
    expect(editState.safeParse({ ...s, music: { trackId: "x" } }).success).toBe(false);
    expect(editState.safeParse({ ...s, captions: { ...s.captions, words: [{ w: "", s: 0, e: 1 }] } }).success).toBe(false);
  });
});

describe("render payload", () => {
  const s = { ...defaultEditState(clip, words), trim: { start: 10.5, end: 40 } };
  const vision = { width: 1920, height: 1080, track: [[9, 0.3], [10, 0.4], [11, 0.5], [41, 0.9]] as [number, number][] };

  it("plan decides resolution and watermark", () => {
    expect(renderSpec("free")).toEqual({ height: 720, watermark: true });
    expect(renderSpec("pro")).toEqual({ height: 1080, watermark: false });
    expect(renderPayload(s, vision, "free")).toMatchObject({ height: 720, watermark: true });
  });

  it("words and crop keyframes are relative to the trim start; first keyframe at 0", () => {
    const p = renderPayload(s, vision, "pro");
    expect(p.words.map((w) => [w.w, w.s, w.e])).toEqual([["à", 0, 0.1], ["tous", 0.2, 0.5]]);
    expect(p.track).toEqual([[0, 0.4], [0.5, 0.5]]);
    expect(p.src_size).toEqual([1920, 1080]);
  });

  it("crop modes and sources that need no horizontal crop", () => {
    expect(renderPayload({ ...s, crop: { mode: "center", x: 0.2 } }, vision, "pro").track).toEqual([]);
    expect(renderPayload({ ...s, crop: { mode: "manual", x: 0.2 } }, vision, "pro").track).toEqual([[0, 0.2]]);
    expect(renderPayload(s, { ...vision, width: 1080, height: 1920 }, "pro").track).toEqual([]);
    expect(renderPayload(s, null, "pro")).toMatchObject({ track: [], src_size: null });
  });

  it("captions off sends no words", () => {
    expect(renderPayload({ ...s, captions: { ...s.captions, enabled: false } }, vision, "pro").words).toEqual([]);
  });
});
