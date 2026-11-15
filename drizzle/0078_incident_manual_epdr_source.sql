-- Explicit local EPDR handoff Incidents are distinct from ingestion-created 'epdr'
-- incidents. Extend the existing source CHECK without rewriting any rows.
ALTER TABLE "incidents" DROP CONSTRAINT "incidents_source_check";
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_source_check"
  CHECK ("source" IN ('manual', 'checklist', 'siem', 'epdr', 'epdr_manual'));
