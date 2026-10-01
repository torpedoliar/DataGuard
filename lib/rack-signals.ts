// Pure audit signals shared by the 3D scene, the drawer and the server
// payload. No React, no three: unit-tested on their own.

export const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_COLOR: Record<Severity, string> = {
    Low: "#3b82f6",
    Medium: "#eab308",
    High: "#f97316",
    Critical: "#ef4444",
};

export interface OpenIncidents {
    count: number;
    maxSeverity: Severity | null;
}

export const NO_INCIDENTS: OpenIncidents = { count: 0, maxSeverity: null };

// Rows from `GROUP BY device_id, severity` (open incidents only) folded into
// one entry per device.
export function foldIncidents(rows: { deviceId: number; severity: Severity; count: number }[]): Map<number, OpenIncidents> {
    const out = new Map<number, OpenIncidents>();
    for (const r of rows) {
        const cur = out.get(r.deviceId) ?? NO_INCIDENTS;
        const worse = cur.maxSeverity === null || SEVERITIES.indexOf(r.severity) > SEVERITIES.indexOf(cur.maxSeverity);
        out.set(r.deviceId, { count: cur.count + Number(r.count), maxSeverity: worse ? r.severity : cur.maxSeverity });
    }
    return out;
}
