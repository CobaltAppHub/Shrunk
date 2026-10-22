// Single source of truth for plans and the credit price list. All prices TTC, EUR cents.
export const CREDIT_COSTS = {
  render_hd: 1,
  voiceover: 1,
  faceless_video: 3,
  veo_lite_8s: 5,
  veo_standard_8s: 30,
} as const;
export type PaidAction = keyof typeof CREDIT_COSTS;

export type PlanId = "free" | "starter" | "pro" | "agency";

type Plan = {
  monthlyCents: number;
  monthlyCredits: number;
  maxHeight: 720 | 1080;
  watermark: boolean;
  autoPublish: boolean;
  socialAccounts: number; // Infinity = unlimited
  seats: number;
  brandKits: number;
  // Separate from render credits: protects GPU/ASR spend on free previews.
  monthlyImports: number;
  monthlyAnalysisMinutes: number;
};

// ponytail: import/analysis quotas are first guesses, revisit with COSTS.md once real GPU costs are known.
export const PLANS: Record<PlanId, Plan> = {
  free:    { monthlyCents: 0,    monthlyCredits: 3,   maxHeight: 720,  watermark: true,  autoPublish: false, socialAccounts: 0,        seats: 1, brandKits: 0,        monthlyImports: 5,   monthlyAnalysisMinutes: 60 },
  starter: { monthlyCents: 1500, monthlyCredits: 60,  maxHeight: 1080, watermark: false, autoPublish: true,  socialAccounts: 3,        seats: 1, brandKits: 0,        monthlyImports: 30,  monthlyAnalysisMinutes: 600 },
  pro:     { monthlyCents: 2900, monthlyCredits: 200, maxHeight: 1080, watermark: false, autoPublish: true,  socialAccounts: 10,       seats: 1, brandKits: 1,        monthlyImports: 100, monthlyAnalysisMinutes: 1800 },
  agency:  { monthlyCents: 7900, monthlyCredits: 600, maxHeight: 1080, watermark: false, autoPublish: true,  socialAccounts: Infinity, seats: 5, brandKits: Infinity, monthlyImports: 300, monthlyAnalysisMinutes: 6000 },
};

export const ANNUAL_DISCOUNT = 0.2;
export const yearlyCents = (plan: PlanId) => Math.round(PLANS[plan].monthlyCents * 12 * (1 - ANNUAL_DISCOUNT));

// One-off packs never expire.
export const CREDIT_PACKS = {
  pack_50: { credits: 50, cents: 1500 },
  pack_200: { credits: 200, cents: 4900 },
} as const;
export type PackId = keyof typeof CREDIT_PACKS;

// Stripe prices are looked up by lookup_key, so no price IDs live in env.
export const stripeLookupKey = (plan: Exclude<PlanId, "free">, interval: "month" | "year") =>
  `${plan}_${interval}`;

// Monthly credits expire at the start of month M+2 (granted in Oct → usable until Nov 30).
export function grantExpiry(grantedAt: Date): Date {
  return new Date(Date.UTC(grantedAt.getUTCFullYear(), grantedAt.getUTCMonth() + 2, 1));
}

export const JOB_TIMEOUT_MS = 15 * 60_000;
export const WITHDRAWAL_DAYS = 14;
export const WITHDRAWAL_MAX_RENDERS = 5;

/** EU 14-day withdrawal: first month refunded on request if fewer than 5 renders were delivered. */
export const withdrawalEligible = (subscribedAt: Date, now: Date, deliveredRenders: number) =>
  now.getTime() - subscribedAt.getTime() <= WITHDRAWAL_DAYS * 86_400_000 && deliveredRenders < WITHDRAWAL_MAX_RENDERS;
