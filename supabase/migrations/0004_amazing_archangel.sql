CREATE TYPE "public"."invoice_status" AS ENUM('unpaid', 'partial', 'paid', 'refunded', 'void');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"period" text NOT NULL,
	"amount_total" numeric(12, 0) NOT NULL,
	"amount_paid" numeric(12, 0) DEFAULT '0' NOT NULL,
	"status" "invoice_status" DEFAULT 'unpaid' NOT NULL,
	"line_items" jsonb NOT NULL,
	"due_date" date,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_student_period_idx" ON "invoices" USING btree ("tenant_id","student_id","period");--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "invoices_tenant_period_idx" ON "invoices" USING btree ("tenant_id","period");