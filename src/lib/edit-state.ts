import { z } from "zod";
import type { Word } from "./clip-selection";
import { PLANS, type PlanId } from "./pricing";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Everything the editor can change on a clip. Times are absolute seconds in the source. */
export const editState = z.object({
  v: z.literal(1),
  trim: z.object({ start: z.number().min(0), end: z.number().positive() }),
  captions: z.object({
    enabled: z.boolean(),
    words: z.array(z.object({ w: z.string().min(1).max(40), s: z.number(), e: z.number(), emphasis: z.boolean().optional() })).max(800),
    style: z.object({
      preset: z.enum(["bold", "clean", "karaoke"]),
      position: z.enum(["bottom", "center", "top"]),
      color: hex,
      highlight: hex,
      uppercase: z.boolean(),
      size: z.number().int().min(40).max(120),
    }),
  }),
  crop: z.object({ mode: z.enum(["auto", "center", "manual"]), x: z.number().min(0).max(1) }),
  // No licensed music library yet: the field exists, the editor keeps it null.
  music: z.null(),
});
export type EditState = z.infer<typeof editState>;

export const MIN_CLIP_S = 5;
export const MAX_CLIP_S = 120;

export function defaultEditState(clip: { startS: number; endS: number }, words: Word[]): EditState {
  return {
    v: 1,
    trim: { start: clip.startS, end: clip.endS },
    captions: {
      enabled: true,
      words: words.filter((w) => w.s >= clip.startS - 0.01 && w.e <= clip.endS + 0.01).map(({ w, s, e }) => ({ w: w.trim(), s, e })),
      style: { preset: "bold", position: "bottom", color: "#FFFFFF", highlight: "#22C55E", uppercase: true, size: 76 },
    },
    crop: { mode: "auto", x: 0.5 },
    music: null,
  };
}

/** Server-side checks that the schema alone cannot express. Returns an error code or null. */
export function validateEdit(state: EditState, bounds: { durationS: number }): "trim_invalid" | "trim_too_short" | "trim_too_long" | null {
  const { start, end } = state.trim;
  if (start >= end || end > bounds.durationS + 0.05) return "trim_invalid";
  if (end - start < MIN_CLIP_S) return "trim_too_short";
  if (end - start > MAX_CLIP_S) return "trim_too_long";
  return null;
}

type Vision = { width: number; height: number; track: [number, number][] } | null;

/** The plan decides output resolution and watermark, never the client. */
export const renderSpec = (plan: PlanId) => ({ height: PLANS[plan].maxHeight, watermark: PLANS[plan].watermark });

/** Payload for worker/render.py: times relative to the trim start, crop track per the chosen mode. */
export function renderPayload(state: EditState, vision: Vision, plan: PlanId) {
  const { start, end } = state.trim;
  const rel = (t: number) => Math.round((t - start) * 100) / 100;
  const words = state.captions.enabled
    ? state.captions.words.filter((w) => w.s >= start && w.e <= end).map((w) => ({ ...w, s: rel(w.s), e: rel(w.e) }))
    : [];
  let track: [number, number][] = [];
  if (vision && vision.width / vision.height > 9 / 16) {
    if (state.crop.mode === "manual") track = [[0, state.crop.x]];
    else if (state.crop.mode === "auto") {
      const inside = vision.track.filter(([t]) => t >= start && t <= end).map(([t, x]) => [rel(t), x] as [number, number]);
      // Keyframe at 0 so the first frame is placed correctly even between samples.
      const before = [...vision.track].reverse().find(([t]) => t <= start);
      track = before && inside[0]?.[0] !== 0 ? [[0, before[1]], ...inside] : inside;
    }
  }
  return {
    start,
    end,
    words,
    style: state.captions.style,
    track,
    src_size: vision ? [vision.width, vision.height] : null,
    ...renderSpec(plan),
  };
}
