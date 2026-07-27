ALTER TYPE "public"."siem_alert_channel" ADD VALUE 'webhook';--> statement-breakpoint
ALTER TYPE "public"."siem_alert_channel" ADD VALUE 'email';--> statement-breakpoint
ALTER TYPE "public"."syslog_vendor" ADD VALUE 'paloalto';--> statement-breakpoint
ALTER TYPE "public"."syslog_vendor" ADD VALUE 'juniper';--> statement-breakpoint
ALTER TYPE "public"."syslog_vendor" ADD VALUE 'checkpoint';--> statement-breakpoint
CREATE TABLE "site_email_addresses" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"email" text NOT NULL,
	"label" text NOT NULL,
	"severity_filter" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "site_webhook_urls" (
	"id" serial PRIMARY KEY NOT NULL,
	"site_id" integer NOT NULL,
	"url" text NOT NULL,
	"label" text NOT NULL,
	"severity_filter" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "siem_alerts" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "site_email_addresses" ADD CONSTRAINT "site_email_addresses_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_webhook_urls" ADD CONSTRAINT "site_webhook_urls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_email_addresses_site_id_idx" ON "site_email_addresses" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "site_webhook_urls_site_id_idx" ON "site_webhook_urls" USING btree ("site_id");