export type DeviceKind = "server" | "network" | "storage" | "power" | "cooling";

// Faceplate style. Word-boundary matches: the 2D icon's includes("ac") also
// matched "rack"/"backup".
export function deviceKind(categoryName: string | null, deviceName = ""): DeviceKind {
    const c = (categoryName ?? "").toLowerCase();
    if (c.includes("network")) return "network";
    if (/\b(ups|pdu|power)\b/.test(c)) return "power";
    if (/\b(crac|ac|cool|cooling)\b/.test(c)) return "cooling";
    if (/\b(storage|nas|san|nvr|dvr)\b/.test(`${c} ${deviceName.toLowerCase()}`)) return "storage";
    return "server";
}
