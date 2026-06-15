CREATE TABLE "siem_dashboard_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"raw_24h" integer DEFAULT 0 NOT NULL,
	"parsed_24h" integer DEFAULT 0 NOT NULL,
	"open_findings" integer DEFAULT 0 NOT NULL,
	"critical_findings" integer DEFAULT 0 NOT NULL,
	"unmapped_sources" integer DEFAULT 0 NOT NULL,
	"pending_alerts" integer DEFAULT 0 NOT NULL,
	"failed_alerts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "siem_dashboard_snapshots_captured_at_idx" ON "siem_dashboard_snapshots" USING btree ("captured_at");