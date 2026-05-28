CREATE TABLE "payroll_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period" text NOT NULL,
	"base_amount" numeric(12, 0) DEFAULT '0' NOT NULL,
	"hours_worked" numeric(8, 2) DEFAULT '0' NOT NULL,
	"hourly_amount" numeric(12, 0) DEFAULT '0' NOT NULL,
	"bonus" numeric(12, 0) DEFAULT '0' NOT NULL,
	"deduction" numeric(12, 0) DEFAULT '0' NOT NULL,
	"total" numeric(12, 0) NOT NULL,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "category" text DEFAULT 'tuition' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "teacher_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hourly_rate" numeric(10, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_base" numeric(10, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_tenant_user_period_idx" ON "payroll_records" USING btree ("tenant_id","user_id","period");--> statement-breakpoint
CREATE INDEX "staff_leaves_tenant_user_idx" ON "staff_leaves" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "staff_leaves_tenant_dates_idx" ON "staff_leaves" USING btree ("tenant_id","starts_on","ends_on");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_teacher_snapshot_id_users_id_fk" FOREIGN KEY ("teacher_snapshot_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_tenant_category_idx" ON "invoices" USING btree ("tenant_id","category");