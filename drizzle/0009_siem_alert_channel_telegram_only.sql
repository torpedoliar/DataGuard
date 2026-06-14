-- Restrict siem_alert_channel to telegram only (N5: drop unimplemented email/webhook).
-- Assumes no rows with channel in (email, webhook) exist; verified by
-- lib/siem/alerts.test.ts which pins the worker filter to 'telegram'.
ALTER TABLE "siem_alerts" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."siem_alert_channel";--> statement-breakpoint
CREATE TYPE "public"."siem_alert_channel" AS ENUM('telegram');--> statement-breakpoint
ALTER TABLE "siem_alerts" ALTER COLUMN "channel" SET DATA TYPE "public"."siem_alert_channel" USING "channel"::"public"."siem_alert_channel";
