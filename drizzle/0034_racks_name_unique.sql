-- Finding #33: racks.name has no unique constraint while app code assumes one.
-- addRack/updateRack catch 'UNIQUE constraint' errors ('Nama rak ini sudah
-- terdaftar') that could never fire; getRackLayout merges racks by lowercased
-- name, so case-variant duplicates ('Rack A' vs 'rack A') render as one rack
-- while collision checks treat them as different.
--
-- The expression index makes rack names unique per site, case-insensitive,
-- matching the lowercased merge key the layout actually uses (and the
-- case-normalized lookups in checkRackCollision/getOccupiedSlots).
--
-- Same live-data hazard as 0033: a database that already contains duplicate
-- or case-variant rack names within one site fails with 23505 on the plain
-- index. Dedupe first — devices bind to racks through the rack_name TEXT
-- column, so re-spell the devices of the deleted rows to the survivor's name.
-- Dedup is restricted to exact equal (site_id, lower(name)) pairs because only
-- those collide in the new index: NULL site_id rows are distinct under
-- PostgreSQL unique-index NULL semantics and must stay untouched.

UPDATE devices d
SET rack_name = keep.name
FROM racks dup
JOIN LATERAL (
    -- Deterministic survivor: the lowest-id rack of the case-variant group.
    -- With three+ variants a bare `keep.id < dup.id` join would pick an
    -- arbitrary keep and could re-spell devices to a rack that is deleted.
    SELECT k2.id, k2.name FROM racks k2
    WHERE k2.site_id = dup.site_id
      AND lower(k2.name) = lower(dup.name)
    ORDER BY k2.id
    LIMIT 1
) keep ON keep.id < dup.id
WHERE d.rack_name = dup.name
  AND d.site_id = dup.site_id;

DELETE FROM racks dup
USING racks keep
WHERE dup.site_id = keep.site_id
  AND lower(dup.name) = lower(keep.name)
  AND dup.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS "racks_site_name_lower_unique" ON "racks" ("site_id", lower("name"));