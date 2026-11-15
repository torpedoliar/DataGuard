-- Preserve historical evidence while allowing an actual reread in a new account
-- revision to create independently verified detection evidence.
ALTER TABLE epdr_detections
  DROP CONSTRAINT epdr_detections_connection_id_source_source_key_key;
--> statement-breakpoint
DROP INDEX IF EXISTS epdr_detections_connection_source_key_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX epdr_detections_connection_source_key_unique
  ON epdr_detections(connection_id, account_revision, source, source_key);
--> statement-breakpoint
-- A reused provider device ID must not overwrite historical endpoint identity or
-- inherit the previous account's local asset assignment.
ALTER TABLE epdr_endpoints
  DROP CONSTRAINT epdr_endpoints_connection_id_wg_device_id_key;
--> statement-breakpoint
DROP INDEX IF EXISTS epdr_endpoints_connection_device_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX epdr_endpoints_connection_device_unique
  ON epdr_endpoints(connection_id, account_revision, wg_device_id);
