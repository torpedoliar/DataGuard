import { describe, expect, it } from "vitest";
import { buildAssetMetadata, matchSyslogSource } from "./source-enrichment";

const source = { id: 1, siteId: 10, deviceId: 100, sourceIp: "10.0.0.1", hostname: "src-host", vendor: "cisco" as const, parserProfile: "cisco" };
const device = { id: 100, siteId: 10, name: "core-sw", ipAddress: "10.0.0.1", assetCode: "AST-1", categoryName: "Switch", brandName: "Cisco", locationName: "MDF", rackName: "R1", rackPosition: 10, zone: "Core" };

describe("matchSyslogSource", () => {
  it("prefers explicit source IP over device IP", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.1", hostname: "core-sw", sources: [source], devices: [{ ...device, id: 200 }] })).toMatchObject({ sourceId: 1, deviceId: 100, matchType: "source_ip" });
  });

  it("matches device IP when source mapping does not exist", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.1", hostname: null, sources: [], devices: [device] })).toMatchObject({ sourceId: null, deviceId: 100, matchType: "device_ip" });
  });

  it("matches hostname when IP does not match", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.9", hostname: "src-host", sources: [source], devices: [] })).toMatchObject({ sourceId: 1, deviceId: 100, matchType: "source_hostname" });
  });

  it("returns unknown when nothing matches", () => {
    expect(matchSyslogSource({ sourceIp: "10.0.0.9", hostname: null, sources: [], devices: [] })).toMatchObject({ sourceId: null, deviceId: null, matchType: "unknown" });
  });
});

describe("buildAssetMetadata", () => {
  it("includes device and site fields", () => {
    expect(buildAssetMetadata({ site: { id: 10, name: "Jakarta", code: "JKT" }, device })).toMatchObject({ siteName: "Jakarta", siteCode: "JKT", deviceName: "core-sw", assetCode: "AST-1", category: "Switch", brand: "Cisco", location: "MDF", rack: "R1", rackPosition: 10, zone: "Core" });
  });
});
