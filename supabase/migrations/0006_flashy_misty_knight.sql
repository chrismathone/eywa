ALTER TABLE "students" ADD COLUMN "ai_care_summary" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ai_care_focus" jsonb;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ai_care_model_version" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ai_care_generated_at" timestamp with time zone;