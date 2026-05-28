CREATE TABLE "user_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text DEFAULT 'google_sheets' NOT NULL,
	"spreadsheet_id" text,
	"spreadsheet_url" text,
	"shared_with_email" text,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_integrations" ADD CONSTRAINT "user_integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_integrations_tenant_provider_idx" ON "user_integrations" USING btree ("tenant_id","provider");