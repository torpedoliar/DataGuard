-- Structured SMTP settings for the Settings UI (Outlook-style account form:
-- host, port, security, auth). smtp_pass is encrypted at rest
-- (lib/crypto.ts, same as smtp_url / siem_settings.ai_api_key).
-- Resolution order in lib/email.ts: env SMTP_URL (legacy, unchanged) →
-- these structured fields → legacy global_settings.smtp_url → dev default.
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_host" text;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_port" integer;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_secure" text;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_user" text;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_pass" text;--> statement-breakpoint
