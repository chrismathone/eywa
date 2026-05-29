CREATE TABLE "super_admin_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"target_tenant_id" uuid,
	"target_label" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sa_audit_created_idx" ON "super_admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sa_audit_target_idx" ON "super_admin_audit_logs" USING btree ("target_tenant_id");