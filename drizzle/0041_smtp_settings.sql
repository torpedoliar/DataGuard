-- SMTP relay config from the Settings UI (lib/email.ts). Stored encrypted
-- at rest with AI_KEY_ENCRYPTION_SECRET (lib/crypto.ts), same as
-- siem_settings.ai_api_key. lib/email.ts resolves env SMTP_URL first, then
-- the DB value, so existing deployments keep working unchanged.
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_url" text;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "smtp_from" text;--> statement-breakpoint
