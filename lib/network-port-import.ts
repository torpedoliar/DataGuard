import type { networkPorts } from "@/db/schema";

export const PORT_IMPORT_COLUMNS = [
  "Port Name",
  "MAC Address",
  "IP Address",
  "Port Mode",
  "VLAN ID",
  "Allowed Trunk VLANs",
  "Status",
  "Speed",
  "Media Type",
  "Description",
] as const;

const portModes = ["Access", "Trunk", "Routed", "LACP"] as const;
const statuses = ["Active", "Inactive", "Down"] as const;
const speeds = ["10/100M", "1G", "10G", "25G", "40G", "100G", "Auto"] as const;
const mediaTypes = ["Copper (RJ45)", "Fiber (SFP/SFP+)", "Twinax (DAC)"] as const;

type ImportRow = Record<string, unknown>;
type VlanRef = { id: number; vlanId: number; name: string };

type ParseOptions = {
  deviceId: number;
  vlanRefs: VlanRef[];
  existingPortNames: string[];
};

type InsertPort = typeof networkPorts.$inferInsert;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number], label: string, rowNumber: number, errors: string[]) {
  const normalized = text(value) || fallback;
  if (!allowed.includes(normalized)) {
    errors.push(`Row ${rowNumber}: ${label} must be one of ${allowed.join(", ")}.`);
    return fallback;
  }
  return normalized as T[number];
}

function hasAnyValue(row: ImportRow) {
  return PORT_IMPORT_COLUMNS.some((column) => text(row[column]));
}

export function parseNetworkPortImportRows(rows: ImportRow[], options: ParseOptions) {
  const errors: string[] = [];
  const ports: InsertPort[] = [];
  const seen = new Set<string>();
  const existing = new Set(options.existingPortNames.map((name) => name.trim().toLowerCase()));
  const vlanByNumber = new Map(options.vlanRefs.map((vlan) => [String(vlan.vlanId), vlan.id]));
  const nonEmptyRows = rows.filter(hasAnyValue);

  if (nonEmptyRows.length === 0) return { ports, errors: ["No port rows found in import file."] };

  nonEmptyRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const portName = text(row["Port Name"]);
    if (!portName) {
      errors.push(`Row ${rowNumber}: Port Name is required.`);
      return;
    }

    const portKey = portName.toLowerCase();
    if (seen.has(portKey)) errors.push(`Row ${rowNumber}: Port Name duplicates another row in this file.`);
    seen.add(portKey);
    if (existing.has(portKey)) errors.push(`Row ${rowNumber}: Port Name already exists on this device.`);

    const vlanNumber = text(row["VLAN ID"]);
    let vlanId: number | null = null;
    if (vlanNumber) {
      vlanId = vlanByNumber.get(vlanNumber) ?? null;
      if (vlanId === null) errors.push(`Row ${rowNumber}: VLAN ID ${vlanNumber} does not exist in this site.`);
    }

    const portMode = normalizeEnum(row["Port Mode"], portModes, "Access", "Port Mode", rowNumber, errors);
    const status = normalizeEnum(row.Status, statuses, "Active", "Status", rowNumber, errors);
    const speed = normalizeEnum(row.Speed, speeds, "1G", "Speed", rowNumber, errors);
    const mediaType = normalizeEnum(row["Media Type"], mediaTypes, "Copper (RJ45)", "Media Type", rowNumber, errors);

    ports.push({
      deviceId: options.deviceId,
      portName,
      macAddress: nullableText(row["MAC Address"]),
      ipAddress: nullableText(row["IP Address"]),
      portMode,
      vlanId,
      trunkVlans: nullableText(row["Allowed Trunk VLANs"]),
      status,
      speed,
      mediaType,
      description: nullableText(row.Description),
    });
  });

  return { ports: errors.length ? [] : ports, errors };
}
