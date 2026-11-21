import { describe, expect, it } from "vitest";
import { isValidLocalQuietWindow, nextLocalNotificationDelivery } from "./local-notification-schedule";

describe("UTC local quiet windows", () => {
  it.each([
    [null, null, true], [0, 23, true], [22, 7, true], [0, 0, false],
    [null, 7, false], [22, null, false], [-1, 7, false], [22, 24, false], [1.5, 7, false],
  ])("validates strict nullable hour pair %s/%s", (quietStart, quietEnd, valid) => {
    expect(isValidLocalQuietWindow({ quietStart, quietEnd })).toBe(valid);
  });
  it.each([
    ["2030-01-01T09:59:59.999Z", 10, 15, "2030-01-01T09:59:59.999Z"],
    ["2030-01-01T10:00:00.000Z", 10, 15, "2030-01-01T15:00:00.000Z"],
    ["2030-01-01T14:59:59.999Z", 10, 15, "2030-01-01T15:00:00.000Z"],
    ["2030-01-01T15:00:00.000Z", 10, 15, "2030-01-01T15:00:00.000Z"],
    ["2030-12-31T22:00:00.000Z", 22, 7, "2031-01-01T07:00:00.000Z"],
    ["2030-01-01T06:59:59.999Z", 22, 7, "2030-01-01T07:00:00.000Z"],
    ["2030-01-01T07:00:00.000Z", 22, 7, "2030-01-01T07:00:00.000Z"],
    ["2030-01-01T23:30:00.000Z", 22, 0, "2030-01-02T00:00:00.000Z"],
    ["2030-01-01T00:00:00.000Z", 0, 7, "2030-01-01T07:00:00.000Z"],
  ])("calculates next delivery %s (%s–%s UTC)", (date, quietStart, quietEnd, expected) => {
    const now = new Date(date);
    expect(nextLocalNotificationDelivery(now, { quietStart, quietEnd }).toISOString()).toBe(expected);
    expect(now.toISOString()).toBe(date);
  });
  it("leaves disabled windows unchanged with a fresh Date", () => {
    const now = new Date("2030-01-01T23:30:00Z");
    const next = nextLocalNotificationDelivery(now, { quietStart: null, quietEnd: null });
    expect(next).toEqual(now); expect(next).not.toBe(now);
  });
  it.each([
    ["2030-01-01T16:30:00Z", "Asia/Jakarta", 22, 7, "2030-01-02T00:00:00.000Z"],
    // Spring-forward: nonexistent 02:00 ends quiet time at the first real 03:00.
    ["2026-03-08T06:30:00Z", "America/New_York", 22, 2, "2026-03-08T07:00:00.000Z"],
    // Fall-back: both occurrences of the repeated hour remain quiet.
    ["2026-11-01T05:30:00Z", "America/New_York", 22, 2, "2026-11-01T07:00:00.000Z"],
  ])("handles local overnight and DST %s", (date, timeZone, quietStart, quietEnd, expected) => {
    expect(nextLocalNotificationDelivery(new Date(date), { timeZone, quietStart, quietEnd }).toISOString()).toBe(expected);
  });
  it("fails closed on invalid date/window", () => {
    expect(() => nextLocalNotificationDelivery(new Date(), { quietStart: 7, quietEnd: 7 })).toThrow();
    expect(() => nextLocalNotificationDelivery(new Date(NaN), { quietStart: null, quietEnd: null })).toThrow();
  });
});
