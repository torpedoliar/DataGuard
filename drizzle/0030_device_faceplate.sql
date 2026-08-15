-- Faceplate layout for switch/router port diagrams: how many physical ports a
-- device exposes and how they are numbered, plus an optional per-port slot
-- override. All columns are nullable/defaulted, so devices without a faceplate
-- keep behaving exactly as before. Mirrors db/schema.ts.
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'faceplate_numbering') THEN
		CREATE TYPE "faceplate_numbering" AS ENUM ('zigzag', 'sequential');
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "faceplate_port_count" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "faceplate_uplink_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "faceplate_rows" integer DEFAULT 2;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "faceplate_numbering" "faceplate_numbering" DEFAULT 'zigzag';--> statement-breakpoint
ALTER TABLE "network_ports" ADD COLUMN IF NOT EXISTS "port_index" integer;
