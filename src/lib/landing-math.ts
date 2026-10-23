import { ANNUAL_DISCOUNT, CREDIT_COSTS, PLANS, type PlanId } from "./pricing";

// Read-only helpers for the public landing: they derive everything from PLANS and CREDIT_COSTS.
export const CLIPS_PER_EXAMPLE_VIDEO = 5;
export const EXAMPLE_VIDEO_MINUTES = 60;

export type PaidPlanId = Exclude<PlanId, "free">;

/** Plans sold on the landing (no free plan), cheapest first. */
export const PAID_PLAN_IDS = (Object.keys(PLANS) as PlanId[])
  .filter((id): id is PaidPlanId => PLANS[id].monthlyCents > 0)
  .sort((a, b) => PLANS[a].monthlyCents - PLANS[b].monthlyCents);

export const yearlyDiscountPercent = Math.round(ANNUAL_DISCOUNT * 100);

/**
 * Number of one-hour videos a plan covers per month when each yields 5 rendered clips.
 * The tightest of three quotas wins: render credits, analysis minutes and imports.
 */
export function hourVideosPerMonth(id: PlanId): number {
  const p = PLANS[id];
  const byCredits = p.monthlyCredits / (CLIPS_PER_EXAMPLE_VIDEO * CREDIT_COSTS.render_hd);
  const byMinutes = p.monthlyAnalysisMinutes / EXAMPLE_VIDEO_MINUTES;
  return Math.floor(Math.min(byCredits, byMinutes, p.monthlyImports));
}

export const creditsForRenders = (renders: number) => renders * CREDIT_COSTS.render_hd;

/** Cheapest paid plan covering both the analysis minutes and the render credits, or null if none does. */
export function minimalPlan(sourceMinutes: number, renderedClips: number): PaidPlanId | null {
  const credits = creditsForRenders(renderedClips);
  return PAID_PLAN_IDS.find((id) => PLANS[id].monthlyAnalysisMinutes >= sourceMinutes && PLANS[id].monthlyCredits >= credits) ?? null;
}
