-- Base URL for Telegram notification links: domain (if any) or server IP.
-- Auto-detected from the request host when a notification fires; the column
-- stores the most recent host the operator opened the app on, so an alert can
-- link to a reachable origin even when sent from a headless worker (which has
-- no request host of its own).
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "notification_base_url" text DEFAULT NULL;--> statement-breakpoint