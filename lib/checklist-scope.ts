// Audit submit scope + ordering for the field checklist form.
// A submit covers only the devices in the active tab (category or rack);
// "All" covers every device. Rack mode orders devices the way the DC is
// walked: zone → rack name (same order as the rack layout page), then rack
// position within the rack.
export type AuditScopeMode = "category" | "rack";

type ScopeDevice = {
  id: number;
  name: string;
  categoryId: number;
  rackName: string | null;
  rackPosition: number | null;
  assetType?: string;
  locationId?: number | null;
  locationName?: string | null;
};

export const rackScopeKey = (name: string) => `rack:${name.toLowerCase()}`;

export function facilityScopeKey(device: ScopeDevice) {
  return device.assetType === "pac" || device.assetType === "ups" ? `facility:${device.locationId ?? "unassigned"}:${device.assetType}` : null;
}

export function facilityAuditGroups(devices: ScopeDevice[]) {
  const groups = new Map<string, { name: string; label: string; zone: string | null }>();
  for (const device of devices) {
    const key = facilityScopeKey(device);
    if (key) groups.set(key, { name: key, label: `${device.locationName ?? "Unassigned"} / ${device.assetType === "pac" ? "Cooling" : "Power"}`, zone: null });
  }
  return [...groups.values()];
}

type ScopeRack = { name: string; zone: string | null };

// Rack tab order = physical walk order: zone first, then rack name.
// (Devices join racks by lowercased name, so case may differ per source.)
export function sortRacksByLayout<T extends ScopeRack>(racks: T[]): T[] {
  return [...racks].sort(
    (a, b) => (a.zone || "").localeCompare(b.zone || "") || a.name.localeCompare(b.name),
  );
}

export function selectScopeDevices<T extends ScopeDevice>(
  devices: T[],
  racks: ScopeRack[],
  mode: AuditScopeMode,
  active: { categoryId?: number; rackNames?: string[] },
): T[] {
  let inScope: T[];
  if (mode === "rack" && active.rackNames && active.rackNames.length > 0) {
    const names = new Set(active.rackNames.map((name) => name.toLowerCase()));
    inScope = devices.filter((d) => {
      const facility = facilityScopeKey(d);
      if (facility) return names.has(facility.toLowerCase());
      return !!d.rackName && (names.has(rackScopeKey(d.rackName)) || names.has(d.rackName.toLowerCase()));
    });
  } else if (active.categoryId) {
    inScope = devices.filter((d) => d.categoryId === active.categoryId);
  } else {
    inScope = devices;
  }

  // Category mode keeps the incoming device order; only rack mode reorders.
  if (mode !== "rack") return inScope;

  const rackOrder = new Map(sortRacksByLayout(racks).map((rack, index) => [rack.name.toLowerCase(), index]));
  const unranked = racks.length;
  return [...inScope].sort((a, b) => {
    const ra = rackOrder.get((a.rackName ?? "").toLowerCase()) ?? unranked;
    const rb = rackOrder.get((b.rackName ?? "").toLowerCase()) ?? unranked;
    if (ra !== rb) return ra - rb;
    const pa = a.rackPosition ?? Number.MAX_SAFE_INTEGER;
    const pb = b.rackPosition ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}
