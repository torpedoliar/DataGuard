-- Personal display preferences never alter the site's scheduling clock.
ALTER TABLE users ADD COLUMN epdr_time_zone text;
--> statement-breakpoint
-- Existing quiet and digest hours were UTC; retain them unchanged.
ALTER TABLE epdr_local_notification_policies ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
--> statement-breakpoint
-- Include the tenant in the local-calendar-day deduplication key.
DROP INDEX epdr_local_outbox_digest_day_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX epdr_local_outbox_digest_day_unique
  ON epdr_local_notification_outbox(site_id, recipient_id, digest_day) WHERE kind = 'digest';
--> statement-breakpoint
-- digest_day is now the scheduling zone's local calendar date.
-- PostgreSQL validates zone names on writes as a second boundary behind Intl.
CREATE FUNCTION epdr_validate_time_zone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE zone text;
BEGIN
  IF TG_TABLE_NAME = 'users' THEN zone := NEW.epdr_time_zone;
  ELSE zone := NEW.time_zone;
  END IF;
  IF zone IS NOT NULL AND (zone <> 'UTC' AND zone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+\-]+)+$'
      OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = zone)) THEN
    RAISE EXCEPTION 'invalid_epdr_time_zone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_epdr_time_zone_valid BEFORE INSERT OR UPDATE OF epdr_time_zone ON users
FOR EACH ROW EXECUTE FUNCTION epdr_validate_time_zone();
--> statement-breakpoint
CREATE TRIGGER epdr_policy_time_zone_valid BEFORE INSERT OR UPDATE OF time_zone ON epdr_local_notification_policies
FOR EACH ROW EXECUTE FUNCTION epdr_validate_time_zone();
