import { describe, it, expect } from "vitest";
import { calculateNextRun } from "./report-schedules";

describe("calculateNextRun", () => {
    it("calculates next daily run correctly when target time is in the future today", () => {
        const base = new Date(2026, 8, 1, 7, 0, 0);
        const next = calculateNextRun("daily", "08:00", 1, 1, base);

        expect(next.getHours()).toBe(8);
        expect(next.getMinutes()).toBe(0);
        expect(next.getDate()).toBe(1);
    });

    it("calculates next daily run for tomorrow when target time already passed today", () => {
        const base = new Date(2026, 8, 1, 9, 30, 0);
        const next = calculateNextRun("daily", "08:00", 1, 1, base);

        expect(next.getHours()).toBe(8);
        expect(next.getMinutes()).toBe(0);
        expect(next.getDate()).toBe(2);
    });

    it("calculates next weekly run for the upcoming specified day of week", () => {
        const base = new Date(2026, 8, 1, 10, 0, 0);
        const next = calculateNextRun("weekly", "08:00", 5, 1, base);

        expect(next.getDay()).toBe(5);
        expect(next.getHours()).toBe(8);
        expect(next.getMinutes()).toBe(0);
        expect(next.getTime()).toBeGreaterThan(base.getTime());
    });

    it("calculates next monthly run for the upcoming specified day of month", () => {
        const base = new Date(2026, 8, 5, 10, 0, 0);
        const next = calculateNextRun("monthly", "08:00", 1, 1, base);

        expect(next.getDate()).toBe(1);
        expect(next.getMonth()).toBe(9);
        expect(next.getHours()).toBe(8);
        expect(next.getMinutes()).toBe(0);
    });
});
