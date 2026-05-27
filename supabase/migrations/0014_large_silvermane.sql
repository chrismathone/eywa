ALTER TABLE "invoices" ADD COLUMN "amount_discount" numeric(12, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "notes" text;