import { describe, expect, it } from "vitest";
import { buildGridExportRows } from "@/lib/grid-export";
import type { DailyCheck } from "./grid";

const dates = ["2026-08-30", "2026-08-31"];

const gridData = [
    {
        name: "sw-core",
        locationName: "Room 1",
        categoryName: "Network",
        statusHistory: {
            "2026-08-30": [
                { status: "OK", username: "budi", shift: "Pagi", time: "08:15" },
            ] as DailyCheck[],
            "2026-08-31": [
                { status: "OK", username: "budi", shift: "Pagi", time: "08:20" },
                { status: "NOT OK", username: "sari", shift: "Siang", time: "14:00" },
            ] as DailyCheck[],
        },
    },
    {
        name: "ups-a",
        locationName: null,
        categoryName: null,
        statusHistory: {
            "2026-08-30": [] as DailyCheck[],
            "2026-08-31": [] as DailyCheck[],
        },
    },
];

describe("buildGridExportRows", () => {
    it("mirrors the grid matrix: one row per device, one column per date", () => {
        const rows = buildGridExportRows(dates, gridData);

        expect(rows).toHaveLength(2);
        expect(rows[0].category).toBe("Network");
        expect(rows[0].device).toBe("sw-core");
        expect(rows[0].location).toBe("Room 1");
        expect(rows[0]["2026-08-30"]).toBe("OK (budi 08:15)");
        // Multiple checks on one day collapse to a "; "-joined summary.
        expect(rows[0]["2026-08-31"]).toBe("OK (budi 08:20); NOT OK (sari 14:00)");
    });

    it("leaves no-check cells empty and falls back to Uncategorized", () => {
        const rows = buildGridExportRows(dates, gridData);

        expect(rows[1]["2026-08-30"]).toBe("");
        expect(rows[1]["2026-08-31"]).toBe("");
        expect(rows[1].category).toBe("Uncategorized");
        expect(rows[1].location).toBeNull();
    });
});
