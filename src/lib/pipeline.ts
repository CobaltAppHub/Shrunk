// Maps the stored project state to the real steps shown to the user. Never guesses a percentage or ETA.
export const STEPS = ["check", "import", "transcribe", "select", "preview"] as const;
export type Step = (typeof STEPS)[number];
export type StepState = "done" | "active" | "pending" | "failed";

export function pipelineSteps(status: string, stage: string | null): Record<Step, StepState> {
  const current: Step | "all" =
    status === "ready" || status === "done" ? "all"
    : status === "importing" || status === "draft" ? "import"
    : (STEPS as readonly string[]).includes(stage ?? "") ? (stage as Step)
    : "transcribe";
  const at = current === "all" ? STEPS.length : STEPS.indexOf(current);
  return Object.fromEntries(STEPS.map((s, i) => [s,
    i < at ? "done" : i > at ? "pending" : status === "failed" ? "failed" : "active",
  ])) as Record<Step, StepState>;
}

export const isTerminal = (status: string) => status === "ready" || status === "done" || status === "failed";
