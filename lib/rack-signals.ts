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

export interface SignalDevice {
    id: number;
    name: string;
    isCritical: boolean;
    status?: string;
    openIncidents: OpenIncidents;
}

// Why a critical device needs attention now, or null. Non-critical devices
// never raise the critical alert; Pending (not audited yet) is not a problem.
export function criticalProblem(d: SignalDevice): string | null {
    if (!d.isCritical) return null;
    const reasons: string[] = [];
    if (d.status === "NOT OK") reasons.push("NOT OK in today's audit");
    const n = d.openIncidents.count;
    if (n > 0) reasons.push(`${n} open incident${n > 1 ? "s" : ""}`);
    return reasons.length ? reasons.join(" · ") : null;
}

export function troubledCritical<D extends SignalDevice>(racks: { name: string; devices: D[] }[]) {
    return racks.flatMap((r) => r.devices.flatMap((device) => {
        const reason = criticalProblem(device);
        return reason ? [{ device, rackName: r.name, reason }] : [];
    }));
}
