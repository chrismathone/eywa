ALTER TABLE "attendance_records" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "homework_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "homework_done" boolean DEFAULT false NOT NULL;