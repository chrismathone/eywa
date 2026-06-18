CREATE TABLE "english_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"abbreviation" text NOT NULL,
	"full_name" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_import_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"week_label" text,
	"snapshot_id" uuid,
	"result" jsonb NOT NULL,
	"details" jsonb,
	"restored_at" timestamp with time zone,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timetable_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text,
	"reference_date" date,
	"summary" jsonb,
	"payload" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "class_schedules" ADD COLUMN "teacher_id" uuid;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD COLUMN "classroom_id" uuid;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD COLUMN "period_label" text;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD COLUMN "merge_group" uuid;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "bg_color" text;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "text_color" text;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "attendance_days" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "is_transferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enrollments" ADD COLUMN "is_transferred_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "english_levels" ADD CONSTRAINT "english_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_import_logs" ADD CONSTRAINT "timetable_import_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_import_logs" ADD CONSTRAINT "timetable_import_logs_snapshot_id_timetable_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."timetable_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_import_logs" ADD CONSTRAINT "timetable_import_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_snapshots" ADD CONSTRAINT "timetable_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_snapshots" ADD CONSTRAINT "timetable_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "english_levels_tenant_abbr_idx" ON "english_levels" USING btree ("tenant_id","abbreviation");--> statement-breakpoint
CREATE INDEX "timetable_import_logs_tenant_idx" ON "timetable_import_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "timetable_snapshots_tenant_idx" ON "timetable_snapshots" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE set null ON UPDATE no action;