import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ── Enums ────────────────────────────────────────────────────────────────────
export const planEnum = pgEnum("plan", ["free", "starter", "pro", "agency"]);
export const roleEnum = pgEnum("role", ["owner", "editor", "viewer"]);
export const platformEnum = pgEnum("social_platform", ["tiktok", "youtube", "instagram"]);
export const sourceKindEnum = pgEnum("source_kind", [
  "upload", "remote_url", "drive", "dropbox", "youtube", "vimeo", "prompt",
]);
export const rightsBasisEnum = pgEnum("rights_basis", ["own", "authorized", "licensed"]);
export const importStatusEnum = pgEnum("import_status", [
  "inspected", "queued", "importing", "imported", "failed",
]);
export const projectModeEnum = pgEnum("project_mode", ["clips", "faceless", "ai_video"]);
export const projectStatusEnum = pgEnum("project_status", [
  "draft", "importing", "analyzing", "ready", "rendering", "done", "failed",
]);
export const aspectEnum = pgEnum("aspect", ["9:16", "1:1", "16:9"]);
export const clipStatusEnum = pgEnum("clip_status", [
  "candidate", "selected", "rendering", "rendered", "failed",
]);
export const jobTypeEnum = pgEnum("job_type", [
  "ingest", "analyze", "render", "tts", "ai_video", "publish",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued", "running", "succeeded", "failed", "cancelled",
]);
export const ledgerKindEnum = pgEnum("ledger_kind", [
  "grant", "reserve", "capture", "release", "refund", "purchase", "expire",
]);
export const postStatusEnum = pgEnum("post_status", [
  "scheduled", "publishing", "published", "failed", "draft_sent",
]);

// ── Auth (Better-Auth core tables; `users` carries product fields) ───────────
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  name: text("name").notNull().default(""),
  image: text("image"),
  locale: text("locale").notNull().default("fr"),
  // Explicit CGU acceptance; null = gate the app until accepted.
  termsAcceptedAt: ts("terms_accepted_at"),
  termsVersion: text("terms_version"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ── Tenancy ──────────────────────────────────────────────────────────────────
export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  plan: planEnum("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  billingInterval: text("billing_interval"), // month | year
  currentPeriodEnd: ts("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const socialAccounts = pgTable("social_accounts", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  externalId: text("external_id").notNull(),
  displayName: text("display_name"),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  scopes: text("scopes").array(),
  expiresAt: ts("expires_at"),
  status: text("status").notNull().default("connected"), // connected | expired | revoked
}, (t) => [uniqueIndex("social_accounts_ws_platform_ext").on(t.workspaceId, t.platform, t.externalId)]);

export const brandKits = pgTable("brand_kits", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  font: text("font"),
  colors: jsonb("colors").$type<Record<string, string>>().notNull().default({}),
  logoUrl: text("logo_url"),
  captionStyle: jsonb("caption_style").$type<Record<string, unknown>>().notNull().default({}),
  introUrl: text("intro_url"),
  outroUrl: text("outro_url"),
});

// ── Sources (extended for URL import) ────────────────────────────────────────
export const sourceAssets = pgTable("source_assets", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: sourceKindEnum("kind").notNull(),
  // May embed access tokens (signed URLs): treat as a secret, never log, never return to the client.
  originalUrlEnc: text("original_url_enc"),
  canonicalUrl: text("canonical_url"), // stripped of query secrets, safe to display
  platform: text("platform"),
  externalVideoId: text("external_video_id"),
  sourceTitle: text("source_title"),
  sourceCreatorName: text("source_creator_name"),
  sourceCreatorUrl: text("source_creator_url"),
  thumbnailUrl: text("thumbnail_url"),
  creditLine: text("credit_line"), // editable attribution shown on exports
  rightsBasis: rightsBasisEnum("rights_basis"),
  rightsAttestedAt: ts("rights_attested_at"),
  rightsAttestedBy: text("rights_attested_by").references(() => users.id),
  licenseReference: text("license_reference"),
  importProvider: text("import_provider"),
  importStatus: importStatusEnum("import_status").notNull().default("inspected"),
  importErrorCode: text("import_error_code"),
  importedBytes: bigint("imported_bytes", { mode: "number" }),
  contentHash: text("content_hash"),
  storageKey: text("storage_key"),
  durationS: real("duration_s"),
  language: text("language"),
  transcript: jsonb("transcript"),
  purgeAfter: ts("purge_after"), // set to imported_at + 30 d
  createdAt: createdAt(),
}, (t) => [index("source_assets_ws").on(t.workspaceId)]);

export const projects = pgTable("projects", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceAssetId: uuid("source_asset_id").references(() => sourceAssets.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  mode: projectModeEnum("mode").notNull().default("clips"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  status: projectStatusEnum("status").notNull().default("draft"),
  createdAt: createdAt(),
});

export const clips = pgTable("clips", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  startS: real("start_s").notNull(),
  endS: real("end_s").notNull(),
  score: integer("score").notNull(),
  scoreReasons: jsonb("score_reasons").notNull(),
  hook: text("hook"),
  title: text("title"),
  hashtags: text("hashtags").array().notNull().default(sql`'{}'::text[]`),
  aspect: aspectEnum("aspect").notNull().default("9:16"),
  editState: jsonb("edit_state").notNull().default({}),
  previewKey: text("preview_key"),
  renderKey: text("render_key"),
  status: clipStatusEnum("status").notNull().default("candidate"),
});

// ── Jobs & money ─────────────────────────────────────────────────────────────
export const jobs = pgTable("jobs", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  type: jobTypeEnum("type").notNull(),
  refId: uuid("ref_id").notNull(),
  // Client-supplied (double-click) or derived (retry) key; one job per key, ever.
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: jobStatusEnum("status").notNull().default("queued"),
  progress: real("progress"), // 0..1 only when measurable
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  creditCost: integer("credit_cost").notNull().default(0),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  createdAt: createdAt(),
}, (t) => [index("jobs_ws_status").on(t.workspaceId, t.status)]);

// Balance = SUM(delta). Rows are never updated or deleted.
export const creditLedger = pgTable("credit_ledger", {
  id: id(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  kind: ledgerKindEnum("kind").notNull(),
  jobId: uuid("job_id").references(() => jobs.id),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  expiresAt: ts("expires_at"), // grants only; packs never expire
  reason: text("reason").notNull(),
  createdAt: createdAt(),
}, (t) => [index("credit_ledger_ws").on(t.workspaceId)]);

export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(), // evt_… — insert-or-skip makes webhooks idempotent
  type: text("type").notNull(),
  receivedAt: createdAt(),
});

// ── Publishing & analytics ───────────────────────────────────────────────────
export const scheduledPosts = pgTable("scheduled_posts", {
  id: id(),
  clipId: uuid("clip_id").notNull().references(() => clips.id, { onDelete: "cascade" }),
  socialAccountId: uuid("social_account_id").notNull().references(() => socialAccounts.id, { onDelete: "cascade" }),
  caption: text("caption").notNull(),
  scheduledAt: ts("scheduled_at").notNull(),
  status: postStatusEnum("status").notNull().default("scheduled"),
  externalPostId: text("external_post_id"),
  error: text("error"),
});

export const postMetrics = pgTable("post_metrics", {
  postId: uuid("post_id").notNull().references(() => scheduledPosts.id, { onDelete: "cascade" }),
  fetchedAt: ts("fetched_at").notNull(),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
  watchTimeS: integer("watch_time_s"),
}, (t) => [primaryKey({ columns: [t.postId, t.fetchedAt] })]);

export const auditLog = pgTable("audit_log", {
  id: id(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references(() => users.id),
  action: text("action").notNull(),
  target: text("target"),
  meta: jsonb("meta").notNull().default({}),
  createdAt: createdAt(),
});

// DSA notice-and-action (public form, 72 h SLA).
export const contentReports = pgTable("content_reports", {
  id: id(),
  reporterEmail: text("reporter_email").notNull(),
  targetUrl: text("target_url").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull(),
  status: text("status").notNull().default("open"), // open | actioned | rejected
  dueAt: ts("due_at").notNull().default(sql`now() + interval '72 hours'`),
  createdAt: createdAt(),
});
