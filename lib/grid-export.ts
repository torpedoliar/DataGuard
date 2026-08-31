// Pure (non-server-action) helpers for the Audit Grid export. Kept out of
// actions/grid.ts because Next.js requires every exported function in a
// "use server" module to be async — these are sync and unit-tested directly.
import type { DailyCheck } from "@/actions/grid";

export type GridExportRow = {
    category: string;
    device: string;
    location: string | null;
    [date: string]: string | number | null | undefined;
};

/**
 * Matrix builder for the grid export: one row per device, one column per
 * date, mirroring the on-screen Audit Grid. Multiple checks on one day
 * collapse to "OK (budi 08:15); NOT OK (sari 14:00)" style summary text; no
 * checks → empty cell.
 */
export function buildGridExportRows(
    dates: string[],
    gridData: Array<{
        name: string;
        locationName: string | null;
        categoryName: string | null;
        statusHistory: Record<string, DailyCheck[]>;
    }>,
): GridExportRow[] {
    return gridData.map((device) => {
        const row: GridExportRow = {
            category: device.categoryName || "Uncategorized",
            device: device.name,
            location: device.locationName,
        };
        for (const date of dates) {
            const checks = device.statusHistory[date] || [];
            if (checks.length === 0) {
                row[date] = "";
            } else if (checks.length === 1) {
                const check = checks[0];
                row[date] = check.status === "OK" ? "OK" : `NOT OK (${check.username} ${check.time})`;
            } else {
                row[date] = checks
                    .map((c) => `${c.status} (${c.username} ${c.time})`)
                    .join("; ");
            }
        }
        return row;
    });
}
