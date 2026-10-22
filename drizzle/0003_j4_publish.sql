ALTER TYPE "public"."post_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "ai_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "connected_by" text;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD COLUMN "connected_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_posts_ws_time" ON "scheduled_posts" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_idempotency_key_unique" UNIQUE("idempotency_key");