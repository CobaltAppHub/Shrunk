import { DEMO } from "./demo";

export const CRITERIA = ["hook", "standalone", "emotion", "pace", "duration"] as const;
export type Criterion = (typeof CRITERIA)[number];

/** Each criterion is worth 0-20 points, so a clip score is out of 100 (see src/lib/clip-selection.ts). */
export const CRITERION_MAX = 20;

export type DemoClip = {
  title: string;
  startS: number;
  endS: number;
  /** Points per criterion, as stored on the real clip (scoreReasons.*.score). */
  points: Record<Criterion, number>;
};

export const DEMO_CLIP_COUNT = 3;

/**
 * Real clips produced by running Shrunk on the NASA demo (DEMO).
 * Fill this with the three clips of the E2E project (title, start/end in seconds, per-criterion points).
 * While it is empty the landing shows "Démo réelle bientôt" and no metric at all: never type values by hand.
 */
export const DEMO_CLIPS: readonly DemoClip[] = [];

export const clipScore = (c: DemoClip) => CRITERIA.reduce((sum, k) => sum + c.points[k], 0);

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Returns a list of problems; an empty list means the clips can be displayed. */
export function validateDemoClips(clips: readonly DemoClip[], durationS: number = DEMO.durationS): string[] {
  const problems: string[] = [];
  if (clips.length !== DEMO_CLIP_COUNT) problems.push(`expected ${DEMO_CLIP_COUNT} clips, got ${clips.length}`);
  clips.forEach((c, i) => {
    if (!c.title.trim()) problems.push(`clip ${i}: empty title`);
    if (!(c.startS >= 0 && c.endS > c.startS && c.endS <= durationS)) problems.push(`clip ${i}: range outside the ${durationS} s source`);
    for (const k of CRITERIA) {
      const p = c.points[k];
      if (!Number.isInteger(p) || p < 0 || p > CRITERION_MAX) problems.push(`clip ${i}: ${k} must be an integer in 0-${CRITERION_MAX}`);
    }
  });
  const sorted = [...clips].sort((a, b) => a.startS - b.startS);
  sorted.slice(1).forEach((c, i) => { if (c.startS < sorted[i]!.endS) problems.push("clips overlap"); });
  return problems;
}

/** The clips to show, or null when the real outputs are not available yet. */
export function availableDemoClips(clips: readonly DemoClip[] = DEMO_CLIPS): DemoClip[] | null {
  return clips.length > 0 && validateDemoClips(clips).length === 0 ? [...clips].sort((a, b) => a.startS - b.startS) : null;
}
