import { describe, expect, it } from "vitest";
import { deviceKind } from "./device-kind";

describe("deviceKind", () => {
  it.each([
    ["Network", "Core Switch", "network"],
    ["Network Device", "", "network"],
    ["UPS", "APC Smart", "power"],
    ["Power Distribution", "", "power"],
    ["CRAC", "", "cooling"],
    ["Rack Accessories", "", "server"],
    ["Server", "NAS QNAP", "storage"],
    ["Storage", "ZFS", "storage"],
    ["CCTV", "NVR Dahua 2", "storage"],
    [null, "Mystery", "server"],
  ] as const)("%s / %s -> %s", (category, name, kind) => {
    expect(deviceKind(category, name)).toBe(kind);
  });
});
