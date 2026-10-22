ALTER TYPE "public"."job_type" ADD VALUE 'vision' BEFORE 'preview';--> statement-breakpoint
ALTER TABLE "source_assets" ADD COLUMN "vision" jsonb;