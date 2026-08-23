-- Network-doc sync concurrency guards (lib/network-doc.ts):
--
-- syncNetworkDocs is select-first upsert (no ON CONFLICT possible without a
-- unique index) and can run concurrently — the hourly worker plus an operator
-- clicking "Sync now" both target the same site. Two runs read the same empty
-- state and each insert, fabricating duplicate rows:
--   - vlans(site_id, vlan_id): two identical VLAN rows; ports then map to
--     whichever copy the in-memory cache saw first.
--   - network_ports(device_id, port_name): duplicate port rows per device;
--     the sync already warns "duplicate rows in dc-check" when it sees them.
--
-- Unique indexes make the race impossible instead of merely unlikely. Same
-- live-data hazard as 0033/0034: a database that already holds duplicates
-- fails with 23505 on CREATE UNIQUE INDEX, so dedupe first. Survivors are the
-- lowest id of each group; rows referencing the deleted copies are re-pointed
-- at the survivor (network_ports.vlan_id FK, port self-links keep their id).

-- ---- dedupe vlans: (site_id, vlan_id) ----
UPDATE network_ports p
SET vlan_id = keep.id
FROM vlans dup
JOIN LATERAL (
    SELECT k2.id FROM vlans k2
    WHERE k2.site_id = dup.site_id
      AND k2.vlan_id = dup.vlan_id
    ORDER BY k2.id
    LIMIT 1
) keep ON keep.id < dup.id
WHERE p.vlan_id = dup.id;

DELETE FROM vlans dup
USING vlans keep
WHERE dup.site_id IS NOT DISTINCT FROM keep.site_id
  AND dup.vlan_id = keep.vlan_id
  AND dup.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS "vlans_site_vlan_unique" ON "vlans" ("site_id", "vlan_id");

-- ---- dedupe network_ports: (device_id, port_name) ----
UPDATE network_ports other
SET connected_to_port_id = keep.id
FROM network_ports dup
JOIN LATERAL (
    SELECT k2.id FROM network_ports k2
    WHERE k2.device_id = dup.device_id
      AND k2.port_name = dup.port_name
    ORDER BY k2.id
    LIMIT 1
) keep ON keep.id < dup.id
WHERE other.connected_to_port_id = dup.id;

DELETE FROM network_ports dup
USING network_ports keep
WHERE dup.device_id = keep.device_id
  AND dup.port_name = keep.port_name
  AND dup.id > keep.id;

CREATE UNIQUE INDEX IF NOT EXISTS "network_ports_device_port_name_unique" ON "network_ports" ("device_id", "port_name");
