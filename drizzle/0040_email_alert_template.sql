-- Editable PIC email template (lib/email.ts), following the Telegram alert
-- template pattern (global_settings.telegram_alert_template): admins customize
-- the NOT-OK alert email from Settings. Same {field} placeholder syntax.
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "email_alert_template" text;--> statement-breakpoint
