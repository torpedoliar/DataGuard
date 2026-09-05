-- SIEM rule mappings (P0 gap analysis): MITRE ATT&CK + ISO 27001 control tags
-- on siem_rules. Metadata only — the rule engine ignores these columns; they
-- exist so default rules can carry tactic/technique/control tags and admins can
-- adjust them, and so a coverage matrix can be computed from enabled rules.
-- jsonb arrays of strings, consistent with group_by/tags columns.

ALTER TABLE "siem_rules" ADD COLUMN IF NOT EXISTS "mitre_tactics" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "siem_rules" ADD COLUMN IF NOT EXISTS "mitre_techniques" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "siem_rules" ADD COLUMN IF NOT EXISTS "iso_controls" jsonb NOT NULL DEFAULT '[]'::jsonb;
