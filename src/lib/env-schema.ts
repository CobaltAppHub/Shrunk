import { z } from "zod";

// Kept apart from env.ts so scripts can validate without crashing at import.
// Optional groups: a connector whose keys are missing is reported as unavailable, never faked.
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  // 32-byte base64 key for AES-256-GCM (source URLs, social tokens)
  DATA_ENCRYPTION_KEY: z.string().min(40),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  WORKER_URL: z.url(), // Modal asgi app base URL
  WORKER_TOKEN: z.string().min(32),
  WORKER_CALLBACK_SECRET: z.string().min(32),
  // Publishing (J4). Missing credentials = platform hidden, never faked.
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_AUDITED: z.enum(["0", "1"]).default("0"), // "1" only once TikTok has audited the app: direct post instead of inbox
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_DAILY_UPLOADS: z.coerce.number().int().positive().default(100), // Google Cloud project's "Video Uploads" quota
  INSTAGRAM_APP_ID: z.string().optional(),
  INSTAGRAM_APP_SECRET: z.string().optional(),
  VIMEO_CLIENT_ID: z.string().optional(),
  VIMEO_CLIENT_SECRET: z.string().optional(),
  GOOGLE_PICKER_API_KEY: z.string().optional(),
  DROPBOX_APP_KEY: z.string().optional(),
});

