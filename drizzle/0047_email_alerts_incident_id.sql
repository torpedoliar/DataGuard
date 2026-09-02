ALTER TABLE "email_alerts" ADD COLUMN IF NOT EXISTS "incident_id" integer REFERENCES "incidents"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "email_alerts_incident_id_idx" ON "email_alerts" ("incident_id");
