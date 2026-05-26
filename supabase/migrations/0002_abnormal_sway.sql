CREATE TYPE "public"."consultation_outcome" AS ENUM('pending', 'scheduled', 'consulted', 'ai_done', 'enrolled', 'declined', 'no_show');--> statement-breakpoint
CREATE TABLE "consultation_ai_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consultation_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"recommended_class_ids" uuid[],
	"diagnosis" jsonb NOT NULL,
	"learning_plan" jsonb NOT NULL,
	"print_payload" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid
);
--> statement-breakpoint
CREATE TABLE "enrollment_consultations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prospect_name" text NOT NULL,
	"prospect_grade" text,
	"prospect_school" text,
	"parent_name" text,
	"parent_phone" text,
	"parent_request" text,
	"learning_history" jsonb,
	"consultant_id" uuid,
	"outcome" "consultation_outcome" DEFAULT 'pending' NOT NULL,
	"student_id" uuid,
	"consulted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consultation_ai_analysis" ADD CONSTRAINT "consultation_ai_analysis_consultation_id_enrollment_consultations_id_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."enrollment_consultations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_ai_analysis" ADD CONSTRAINT "consultation_ai_analysis_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD CONSTRAINT "enrollment_consultations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD CONSTRAINT "enrollment_consultations_consultant_id_users_id_fk" FOREIGN KEY ("consultant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_consultations" ADD CONSTRAINT "enrollment_consultations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_consultation_model_idx" ON "consultation_ai_analysis" USING btree ("consultation_id","model_version");--> statement-breakpoint
CREATE INDEX "ec_tenant_outcome_idx" ON "enrollment_consultations" USING btree ("tenant_id","outcome");--> statement-breakpoint
CREATE INDEX "ec_tenant_consulted_idx" ON "enrollment_consultations" USING btree ("tenant_id","consulted_at");