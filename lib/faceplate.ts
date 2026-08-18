/**
 * Faceplate layout model for switch / router documentation.
 *
 * Pure geometry + slot resolution: no React, no DB, no browser APIs. Both the
 * on-screen SVG renderer (components/admin/device-faceplate.tsx) and the PDF
 * export draw from the output of `buildFaceplate`, so the printed faceplate is
 * identical to the one on screen.
 */

export const FACEPLATE_NUMBERING = ["zigzag", "sequential"] as const;
export type FaceplateNumbering = (typeof FACEPLATE_NUMBERING)[number];

export const FACEPLATE_ROW_OPTIONS = [1, 2] as const;
export type FaceplateRows = (typeof FACEPLATE_ROW_OPTIONS)[number];

export const FACEPLATE_MAX_PORTS = 96;
export const FACEPLATE_MAX_UPLINKS = 16;

export type FaceplateConfigInput = {
  portCount?: number | null;
  uplinkCount?: number | null;
  rows?: number | null;
  numbering?: string | null;
};

export type FaceplateConfig = {
  portCount: number;
  uplinkCount: number;
  rows: FaceplateRows;
  numbering: FaceplateNumbering;
};

export type FaceplateBlockName = "access" | "uplink";

/** Minimum shape a port must have to be placed on a faceplate. */
export type FaceplatePortLike = {
  id: number;
  portName: string;
  portIndex?: number | null;
  mediaType?: string | null;
};

export type FaceplateSlot<T extends FaceplatePortLike> = {
  key: string;
  block: FaceplateBlockName;
  /** 1-based slot number across the whole faceplate (access block first). */
  slotNumber: number;
  /** 1-based slot number inside its own block. */
  blockNumber: number;
  row: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
  port: T | null;
};

export type FaceplateBlock = {
  block: FaceplateBlockName;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  labelY: number;
};

export type Faceplate<T extends FaceplatePortLike> = {
  config: FaceplateConfig;
  slots: FaceplateSlot<T>[];
  blocks: FaceplateBlock[];
  /** Ports that could not be mapped to a physical slot. */
  unplaced: T[];
  width: number;
  height: number;
};

/** Abstract drawing units. Consumed as SVG user units and scaled for PDF. */
export const FACEPLATE_METRICS = {
  padding: 10,
  portWidth: 22,
  uplinkPortWidth: 28,
  portHeight: 18,
  gapX: 3,
  gapY: 3,
  blockGap: 16,
  labelHeight: 10,
} as const;

export const FACEPLATE_PALETTE = {
  chassis: { fill: "#0f172a", stroke: "#334155" },
  empty: { fill: "#1e293b", stroke: "#334155", label: "#64748b" },
  active: { fill: "#15803d", stroke: "#22c55e", label: "#f8fafc" },
  inactive: { fill: "#475569", stroke: "#64748b", label: "#f1f5f9" },
  down: { fill: "#b91c1c", stroke: "#ef4444", label: "#fef2f2" },
  unknown: { fill: "#334155", stroke: "#475569", label: "#e2e8f0" },
} as const;

export const FACEPLATE_MODE_ACCENT: Record<string, string> = {
  Trunk: "#a855f7",
  Routed: "#f97316",
  LACP: "#38bdf8",
};

const naturalOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

/** A faceplate can only be drawn once an admin has declared how many ports the device has. */
export function isFaceplateConfigured(input: FaceplateConfigInput | null | undefined): boolean {
  if (!input) return false;
  return clampInt(input.portCount, 0, FACEPLATE_MAX_PORTS, 0) > 0;
}

export function normalizeFaceplateConfig(input: FaceplateConfigInput | null | undefined): FaceplateConfig {
  const numbering = FACEPLATE_NUMBERING.includes(input?.numbering as FaceplateNumbering)
    ? (input?.numbering as FaceplateNumbering)
    : "zigzag";

  return {
    portCount: clampInt(input?.portCount, 0, FACEPLATE_MAX_PORTS, 0),
    uplinkCount: clampInt(input?.uplinkCount, 0, FACEPLATE_MAX_UPLINKS, 0),
    rows: clampInt(input?.rows, 1, 2, 2) as FaceplateRows,
    numbering,
  };
}

/**
 * Logical interfaces that name a virtual construct (VLAN SVI, link bundle)
 * rather than a physical port. They never map to a faceplate slot on their
 * own; an admin can still pin one to a slot with an explicit portIndex.
 */
const LOGICAL_INTERFACE_NAME = /^(vlan|port-channel|portchannel)\d*$/i;

/**
 * Derives a physical port number from a free-text interface name by taking its
 * last numeric group: "Gi1/0/13" -> 13, "ether5" -> 5, "Eth1" -> 1.
 * Subinterface suffixes are stripped first so a router subinterface maps to
 * its physical port: "Gi1/0/2.10" -> 2.
 * Returns null when no usable number is present, including logical interfaces
 * such as "Vlan10" and "Port-Channel1" — the caller routes those to the
 * unplaced list instead of guessing a physical slot.
 */
export function parsePortIndex(portName: string | null | undefined): number | null {
  const physicalName = String(portName ?? "").replace(/\.\d+$/, "");
  if (LOGICAL_INTERFACE_NAME.test(physicalName)) return null;
  const groups = physicalName.match(/\d+/g);
  if (!groups || groups.length === 0) return null;
  const value = Number.parseInt(groups[groups.length - 1], 10);
  if (!Number.isFinite(value) || value < 1) return null;
  return value;
}

export function comparePortNames(a: string, b: string): number {
  return naturalOrder.compare(a, b);
}

/** Splits "Gi1/0/13" into prefix "Gi1/0/" and number 13. */
export function splitPortName(portName: string): { prefix: string; number: number | null } {
  const match = String(portName ?? "").match(/^(.*?)(\d+)$/);
  if (!match) return { prefix: String(portName ?? ""), number: null };
  return { prefix: match[1], number: Number.parseInt(match[2], 10) };
}

/**
 * Suggests an interface name for an empty slot by reusing the naming style the
 * device already follows: the most common prefix among its existing ports.
 */
export function suggestPortName(existingNames: string[], portNumber: number): string | null {
  const counts = new Map<string, number>();

  for (const name of existingNames) {
    const { prefix, number } = splitPortName(name);
    if (number === null) continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  let best: string | null = null;
  let bestCount = 0;
  for (const [prefix, count] of counts) {
    if (count > bestCount) {
      best = prefix;
      bestCount = count;
    }
  }

  return best === null ? null : `${best}${portNumber}`;
}

export function isUplinkMedia(mediaType: string | null | undefined): boolean {
  const media = String(mediaType ?? "").toLowerCase();
  return media.includes("fiber") || media.includes("sfp") || media.includes("twinax") || media.includes("dac");
}

/**
 * Hybrid slot resolution: an explicit `portIndex` always wins, otherwise the
 * number is derived from the interface name and steered into the uplink block
 * when the port uses fiber/twinax media.
 */
export function resolveSlotNumber(port: FaceplatePortLike, config: FaceplateConfig): number | null {
  const total = config.portCount + config.uplinkCount;
  if (total === 0) return null;

  const override = port.portIndex;
  if (typeof override === "number" && Number.isInteger(override) && override >= 1) {
    return override <= total ? override : null;
  }

  const derived = parsePortIndex(port.portName);
  if (derived === null) return null;

  if (isUplinkMedia(port.mediaType) && config.uplinkCount > 0 && derived <= config.uplinkCount) {
    return config.portCount + derived;
  }

  return derived <= total ? derived : null;
}

function blockNumberFor(row: number, column: number, columns: number, rows: FaceplateRows, numbering: FaceplateNumbering) {
  if (rows === 1) return column;
  if (numbering === "zigzag") return (column - 1) * 2 + row;
  return (row - 1) * columns + column;
}

function layoutBlock<T extends FaceplatePortLike>(options: {
  block: FaceplateBlockName;
  count: number;
  offset: number;
  rows: FaceplateRows;
  numbering: FaceplateNumbering;
  portWidth: number;
  x: number;
  y: number;
}): { slots: FaceplateSlot<T>[]; width: number; height: number; columns: number } {
  const { block, count, offset, rows, numbering, portWidth, x, y } = options;
  const { portHeight, gapX, gapY } = FACEPLATE_METRICS;
  const columns = Math.max(1, Math.ceil(count / rows));
  const slots: FaceplateSlot<T>[] = [];

  for (let column = 1; column <= columns; column++) {
    for (let row = 1; row <= rows; row++) {
      const blockNumber = blockNumberFor(row, column, columns, rows, numbering);
      if (blockNumber > count) continue;

      slots.push({
        key: `${block}-${blockNumber}`,
        block,
        slotNumber: offset + blockNumber,
        blockNumber,
        row,
        column,
        x: x + (column - 1) * (portWidth + gapX),
        y: y + (row - 1) * (portHeight + gapY),
        width: portWidth,
        height: portHeight,
        port: null,
      });
    }
  }

  slots.sort((a, b) => a.slotNumber - b.slotNumber);

  return {
    slots,
    width: columns * portWidth + (columns - 1) * gapX,
    height: rows * portHeight + (rows - 1) * gapY,
    columns,
  };
}

/**
 * Builds the full faceplate: every physical slot (occupied or not), plus the
 * ports that could not be mapped so the UI can surface them instead of
 * silently dropping them.
 */
export function buildFaceplate<T extends FaceplatePortLike>(
  configInput: FaceplateConfigInput | null | undefined,
  ports: T[],
): Faceplate<T> {
  const config = normalizeFaceplateConfig(configInput);
  const { padding, portWidth, uplinkPortWidth, blockGap, labelHeight } = FACEPLATE_METRICS;

  const access = layoutBlock<T>({
    block: "access",
    count: config.portCount,
    offset: 0,
    rows: config.rows,
    numbering: config.numbering,
    portWidth,
    x: padding,
    y: padding,
  });

  const blocks: FaceplateBlock[] = [];
  const slots = [...access.slots];

  if (config.portCount > 0) {
    blocks.push({
      block: "access",
      label: `1-${config.portCount}`,
      x: padding,
      y: padding,
      width: access.width,
      height: access.height,
      labelY: padding + access.height + labelHeight - 2,
    });
  }

  let contentWidth = config.portCount > 0 ? access.width : 0;
  let contentHeight = config.portCount > 0 ? access.height : 0;

  if (config.uplinkCount > 0) {
    const uplinkX = padding + contentWidth + (contentWidth > 0 ? blockGap : 0);
    const uplink = layoutBlock<T>({
      block: "uplink",
      count: config.uplinkCount,
      offset: config.portCount,
      rows: config.rows,
      numbering: config.numbering,
      portWidth: uplinkPortWidth,
      x: uplinkX,
      y: padding,
    });

    slots.push(...uplink.slots);
    blocks.push({
      block: "uplink",
      label: `Uplink ${config.portCount + 1}-${config.portCount + config.uplinkCount}`,
      x: uplinkX,
      y: padding,
      width: uplink.width,
      height: uplink.height,
      labelY: padding + uplink.height + labelHeight - 2,
    });

    contentWidth = uplinkX - padding + uplink.width;
    contentHeight = Math.max(contentHeight, uplink.height);
  }

  const slotByNumber = new Map(slots.map((slot) => [slot.slotNumber, slot]));
  const unplaced: T[] = [];

  // Precedence is implemented by pass ordering, not eviction: explicit
  // portIndex overrides are placed first, name-derived guesses second. A guess
  // that would collide with an override therefore falls through to the
  // unplaced list in its own pass. Within each pass, ports are placed in
  // natural interface order and the first port keeps the slot.
  const ordered = [...ports].sort((a, b) => comparePortNames(a.portName, b.portName));
  const hasOverride = (port: T) => typeof port.portIndex === "number" && Number.isInteger(port.portIndex) && port.portIndex >= 1;
  const passes = [ordered.filter(hasOverride), ordered.filter((port) => !hasOverride(port))];

  for (const pass of passes) {
    for (const port of pass) {
      const slotNumber = resolveSlotNumber(port, config);
      const slot = slotNumber === null ? undefined : slotByNumber.get(slotNumber);

      if (!slot) {
        unplaced.push(port);
        continue;
      }

      if (slot.port) {
        // The slot is already taken — keep the earlier port and surface this one.
        unplaced.push(port);
        continue;
      }

      slot.port = port;
    }
  }

  return {
    config,
    slots,
    blocks,
    unplaced,
    width: padding * 2 + contentWidth,
    height: padding * 2 + contentHeight + labelHeight,
  };
}

export type FaceplateSlotColors = { fill: string; stroke: string; label: string; accent: string | null };

export function faceplateSlotColors(port: { status?: string | null; portMode?: string | null } | null): FaceplateSlotColors {
  const accent = port?.portMode ? FACEPLATE_MODE_ACCENT[port.portMode] ?? null : null;
  if (!port) return { ...FACEPLATE_PALETTE.empty, accent: null };

  switch (port.status) {
    case "Active":
      return { ...FACEPLATE_PALETTE.active, accent };
    case "Inactive":
      return { ...FACEPLATE_PALETTE.inactive, accent };
    case "Down":
      return { ...FACEPLATE_PALETTE.down, accent };
    default:
      return { ...FACEPLATE_PALETTE.unknown, accent };
  }
}

/** jsPDF colour setters take numeric channels, SVG takes hex. */
export function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
