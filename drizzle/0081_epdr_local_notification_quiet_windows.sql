-- Local inbox only. Nullable columns leave every existing policy unchanged (quiet window off).
ALTER TABLE epdr_local_notification_policies
  ADD COLUMN quiet_start integer DEFAULT NULL,
  ADD COLUMN quiet_end integer DEFAULT NULL,
  ADD CONSTRAINT epdr_local_notification_quiet_window_check CHECK (
    (quiet_start IS NULL AND quiet_end IS NULL) OR
    (quiet_start IS NOT NULL AND quiet_end IS NOT NULL
      AND quiet_start BETWEEN 0 AND 23 AND quiet_end BETWEEN 0 AND 23
      AND quiet_start <> quiet_end)
  );
