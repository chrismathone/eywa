CREATE TYPE "public"."reenrollment_status" AS ENUM('pending', 'contacted', 'enrolled', 'declined');--> statement-breakpoint
CREATE TABLE "reenrollment_campaign_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" "reenrollment_status" DEFAULT 'pending' NOT NULL,
	"counselor_id" uuid,
	"trigger_reason" text,
	"note" text,
	"contacted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reenrollment_campaign_targets" ADD CONSTRAINT "reenrollment_campaign_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reenrollment_campaign_targets" ADD CONSTRAINT "reenrollment_campaign_targets_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reenrollment_campaign_targets" ADD CONSTRAINT "reenrollment_campaign_targets_counselor_id_users_id_fk" FOREIGN KEY ("counselor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rct_tenant_student_uq" ON "reenrollment_campaign_targets" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "rct_tenant_status_idx" ON "reenrollment_campaign_targets" USING btree ("tenant_id","status");