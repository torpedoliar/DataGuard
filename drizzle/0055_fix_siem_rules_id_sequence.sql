-- siem_rules id sequence fell behind max(id) (observed in production: the seed
-- insert allocated an id that already existed -> duplicate key value violates
-- unique constraint "siem_rules_pkey", crash-looping the rule worker).
-- Realign the sequence to max(id) so inserts allocate fresh ids. Idempotent.
SELECT setval(pg_get_serial_sequence('siem_rules', 'id'), COALESCE((SELECT MAX(id) FROM "siem_rules"), 1));
