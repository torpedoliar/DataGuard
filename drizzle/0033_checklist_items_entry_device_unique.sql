-- Finding #08: make checklist items idempotent per (entry, device).
-- submitChecklist inserts entry + items + incidents inside ONE transaction and
-- uses ON CONFLICT DO NOTHING on the item insert; this unique index makes a
-- retried/concurrent submit of the same entry+device a no-op instead of a
-- duplicate item row (and duplicate derived incidents).
--
-- LIVE-DB HAZARD (hit 2026-08-19): the pre-fix submit already left duplicate
-- (entry_id, device_id) rows in production, so the plain CREATE UNIQUE INDEX
-- failed with 23505. Dedupe first — keep the oldest item of each pair, repoint
-- or drop its incidents (incidents.checklist_item_id is UNIQUE + ON DELETE SET
-- NULL, so deleting the item alone would orphan the incident), then index.
-- All statements are no-ops when no duplicates exist.

-- Move the incident of the LOWEST duplicate item that has one onto the kept
-- (lowest-id) row, but only when the kept row has no incident of its own.
-- DISTINCT ON picks exactly one row per (entry, device) pair, so the UPDATE
-- can never conflict with the incidents.checklist_item_id unique index even
-- when three or more duplicate items exist (the sole incident of a tripled
-- submit lands on the kept row instead of being deleted).
UPDATE incidents i
SET checklist_item_id = g.keep_id
FROM (
    SELECT DISTINCT ON (dup.entry_id, dup.device_id)
           dup.id AS dup_id,
           (SELECT MIN(keep.id) FROM checklist_items keep
             WHERE keep.entry_id = dup.entry_id
               AND keep.device_id = dup.device_id) AS keep_id
    FROM checklist_items dup
    JOIN incidents inc ON inc.checklist_item_id = dup.id
    JOIN checklist_items lower
      ON lower.entry_id = dup.entry_id
     AND lower.device_id = dup.device_id
     AND lower.id < dup.id
    ORDER BY dup.entry_id, dup.device_id, dup.id
) g
WHERE i.checklist_item_id = g.dup_id
  AND NOT EXISTS (SELECT 1 FROM incidents k2 WHERE k2.checklist_item_id = g.keep_id);

-- Drop incidents still attached to duplicate items (the kept item already has
-- its own incident, or this one was redundant — either way it is a duplicate
-- from the double-submit bug). Their incident_updates rows cascade.
DELETE FROM incidents i
USING checklist_items dup
WHERE i.checklist_item_id = dup.id
  AND EXISTS (
      SELECT 1 FROM checklist_items keep
      WHERE keep.entry_id = dup.entry_id
        AND keep.device_id = dup.device_id
        AND keep.id < dup.id
  );

-- Remove the duplicate item rows (lowest id survives).
DELETE FROM checklist_items dup
USING checklist_items keep
WHERE dup.entry_id = keep.entry_id
  AND dup.device_id = keep.device_id
  AND dup.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS "checklist_items_entry_device_unique" ON "checklist_items" ("entry_id", "device_id");