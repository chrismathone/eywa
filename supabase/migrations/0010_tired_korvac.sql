ALTER TABLE "student_consultations" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "student_consultations" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "student_consultations" ADD COLUMN "audience" text;--> statement-breakpoint
ALTER TABLE "student_consultations" ADD COLUMN "follow_up_date" date;--> statement-breakpoint
ALTER TABLE "student_consultations" ADD COLUMN "follow_up_done" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "sc_tenant_followup_idx" ON "student_consultations" USING btree ("tenant_id","follow_up_date");