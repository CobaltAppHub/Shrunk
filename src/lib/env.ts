import { z } from "zod";

// Optional groups: a connector whose keys are missing is reported as unavailable, never faked.
const schema = z.object({
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
  VIMEO_CLIENT_ID: z.string().optional(),
  VIMEO_CLIENT_SECRET: z.string().optional(),
  GOOGLE_PICKER_API_KEY: z.string().optional(),
  DROPBOX_APP_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
