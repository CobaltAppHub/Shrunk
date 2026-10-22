CREATE TYPE "public"."aspect" AS ENUM('9:16', '1:1', '16:9');--> statement-breakpoint
CREATE TYPE "public"."clip_status" AS ENUM('candidate', 'selected', 'rendering', 'rendered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('inspected', 'queued', 'importing', 'imported', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('ingest', 'analyze', 'render', 'tts', 'ai_video', 'publish');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('grant', 'reserve', 'capture', 'release', 'refund', 'purchase', 'expire');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'starter', 'pro', 'agency');--> statement-breakpoint
CREATE TYPE "public"."social_platform" AS ENUM('tiktok', 'youtube', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('scheduled', 'publishing', 'published', 'failed', 'draft_sent');--> statement-breakpoint
CREATE TYPE "public"."project_mode" AS ENUM('clips', 'faceless', 'ai_video');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'importing', 'analyzing', 'ready', 'rendering', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rights_basis" AS ENUM('own', 'authorized', 'licensed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('upload', 'remote_url', 'drive', 'dropbox', 'youtube', 'vimeo', 'prompt');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"font" text,
	"colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"logo_url" text,
	"caption_style" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"intro_url" text,
	"outro_url" text
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"start_s" real NOT NULL,
	"end_s" real NOT NULL,
	"score" integer NOT NULL,
	"score_reasons" jsonb NOT NULL,
	"hook" text,
	"title" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"aspect" "aspect" DEFAULT '9:16' NOT NULL,
	"edit_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_key" text,
	"render_key" text,
	"status" "clip_status" DEFAULT 'candidate' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_email" text NOT NULL,
	"target_url" text NOT NULL,
	"reason" text NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() + interval '72 hours' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"job_id" uuid,
	"idempotency_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "job_type" NOT NULL,
	"ref_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"progress" real,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"credit_cost" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "role" NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"post_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"watch_time_s" integer,
	CONSTRAINT "post_metrics_post_id_fetched_at_pk" PRIMARY KEY("post_id","fetched_at")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_asset_id" uuid,
	"title" text NOT NULL,
	"mode" "project_mode" DEFAULT 'clips' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clip_id" uuid NOT NULL,
	"social_account_id" uuid NOT NULL,
	"caption" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "post_status" DEFAULT 'scheduled' NOT NULL,
	"external_post_id" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"scopes" text[],
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'connected' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "source_kind" NOT NULL,
	"original_url_enc" text,
	"canonical_url" text,
	"platform" text,
	"external_video_id" text,
	"source_title" text,
	"source_creator_name" text,
	"source_creator_url" text,
	"thumbnail_url" text,
	"credit_line" text,
	"rights_basis" "rights_basis",
	"rights_attested_at" timestamp with time zone,
	"rights_attested_by" text,
	"license_reference" text,
	"import_provider" text,
	"import_status" "import_status" DEFAULT 'inspected' NOT NULL,
	"import_error_code" text,
	"imported_bytes" bigint,
	"content_hash" text,
	"storage_key" text,
	"duration_s" real,
	"language" text,
	"transcript" jsonb,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"image" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"terms_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"billing_interval" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "workspaces_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_scheduled_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_asset_id_source_assets_id_fk" FOREIGN KEY ("source_asset_id") REFERENCES "public"."source_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_clip_id_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_rights_attested_by_users_id_fk" FOREIGN KEY ("rights_attested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_ws" ON "credit_ledger" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "jobs_ws_status" ON "jobs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "social_accounts_ws_platform_ext" ON "social_accounts" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "source_assets_ws" ON "source_assets" USING btree ("workspace_id");