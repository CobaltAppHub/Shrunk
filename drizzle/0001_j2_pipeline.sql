ALTER TYPE "public"."job_type" ADD VALUE 'transcribe' BEFORE 'render';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'preview' BEFORE 'render';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "error_code" text;