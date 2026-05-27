ALTER TABLE "meeting_minutes" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "ai_action_items" jsonb;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "ai_model_version" text;--> statement-breakpoint
ALTER TABLE "meeting_minutes" ADD COLUMN "ai_generated_at" timestamp with time zone;