-- Drop TCP/TLS receiver fields from siem_settings (N3: never wired up; syslog receiver is UDP only).
-- IF EXISTS guards make this safe to re-run after a partial apply.
ALTER TABLE "siem_settings" DROP COLUMN IF EXISTS "tcp_enabled";--> statement-breakpoint
ALTER TABLE "siem_settings" DROP COLUMN IF EXISTS "tcp_port";--> statement-breakpoint
ALTER TABLE "siem_settings" DROP COLUMN IF EXISTS "tls_enabled";--> statement-breakpoint
ALTER TABLE "siem_settings" DROP COLUMN IF EXISTS "tls_port";
