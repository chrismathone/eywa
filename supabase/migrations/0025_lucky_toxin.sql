CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT '기타' NOT NULL,
	"amount" numeric(12, 0) DEFAULT '0' NOT NULL,
	"expense_date" date NOT NULL,
	"vendor" text,
	"department" text,
	"author" text,
	"payment_method" text,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"line_items" jsonb,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "textbook_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"student_id" uuid,
	"student_name" text,
	"teacher_name" text,
	"book_name" text NOT NULL,
	"book_detail" text,
	"price" numeric(12, 0) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"request_date" date,
	"ordered_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"billed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_orders" ADD CONSTRAINT "textbook_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "textbook_orders" ADD CONSTRAINT "textbook_orders_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_tenant_date_idx" ON "expenses" USING btree ("tenant_id","expense_date");--> statement-breakpoint
CREATE INDEX "expenses_tenant_category_idx" ON "expenses" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "textbook_orders_tenant_status_idx" ON "textbook_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "textbook_orders_tenant_student_idx" ON "textbook_orders" USING btree ("tenant_id","student_id");--> statement-breakpoint
CREATE INDEX "textbook_orders_tenant_request_idx" ON "textbook_orders" USING btree ("tenant_id","request_date");