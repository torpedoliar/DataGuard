-- Editable PIC email alert subject (lib/email.ts), following the email template pattern:
-- admins customize the email subject sent to PIC groups per NOT-OK devices.
-- Supports {groupName}, {deviceCount}, {deviceNames}, {siteName}, {siteCode}, {shift}, {checkDate}, etc.
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "email_alert_subject" text;--> statement-breakpoint
