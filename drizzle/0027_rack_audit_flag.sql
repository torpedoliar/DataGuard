-- Rack auditability flag: only racks with is_auditable = true get audited
-- Default true so every existing rack stays in the audit flow.
ALTER TABLE "racks" ADD COLUMN IF NOT EXISTS "is_auditable" boolean DEFAULT true;--> statement-breakpoint
