-- Finding #08: make checklist items idempotent per (entry, device).
-- submitChecklist inserts entry + items + incidents inside ONE transaction and
-- uses ON CONFLICT DO NOTHING on the item insert; this unique index makes a
-- retried/concurrent submit of the same entry+device a no-op instead of a
-- duplicate item row (and duplicate derived incidents).
CREATE UNIQUE INDEX IF NOT EXISTS "checklist_items_entry_device_unique" ON "checklist_items" ("entry_id", "device_id");