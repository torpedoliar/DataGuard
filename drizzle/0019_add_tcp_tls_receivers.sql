ALTER TABLE "siem_settings" ADD COLUMN "tcp_port" integer;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD COLUMN "tls_port" integer;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD COLUMN "tls_cert_path" text;--> statement-breakpoint
ALTER TABLE "siem_settings" ADD COLUMN "tls_key_path" text;
