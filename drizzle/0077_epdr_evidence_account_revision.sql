-- Historical rows intentionally remain revision 0 (unverified), never stamped
-- with a current account revision without an actual current-account read.
ALTER TABLE epdr_endpoints ADD COLUMN account_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE epdr_detections ADD COLUMN account_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX epdr_detections_connection_revision_idx ON epdr_detections(connection_id, account_revision, detected_at);
