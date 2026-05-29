import { describe, expect, it } from "vitest";
import { buildAssetMetadata, matchSyslogSource, type DeviceCandidate, type SourceCandidate } from "./source-enrichment";

const source: SourceCandidate = { id: 1, siteId: 10, deviceId: 100, sourceIp: "10.0.0.1", hostname: "src-host", vendor: "cisco", parserProfile: "cisco" };
const device: DeviceCandidate = { id: 100, siteId: 10, name: "core-sw", ipAddress: "10.0.0.1", assetCode: "AST-1", categoryName: "Switch", brandName: "Cisco", locationName: "MDF", rackName: "R1", rackPosition: 10, zone: "Core" };

const natDevice: DeviceCandidate = {
  id: 10,
  siteId: 1,
  name: "core-sw01",
  ipAddress: "10.10.0.18",
  assetCode: null,
  categoryName: null,
  brandName: null,
  locationName: null,
  rackName: null,
  rackPosition: null,
  zone: null,
};

const natSource: SourceCandidate = {
  id: 20,
  siteId: 1,
  deviceId: 10,
  sourceIp: "10.10.0.18",
  hostname: "core-sw01",
  vendor: "generic",
  parserProfile: "generic",
};

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

  it("matches source hostnames case-insensitively when NAT rewrites source IP", () => {
    expect(matchSyslogSource({
      sourceIp: "192.168.127.1",
      hostname: "CORE-SW01",
      sources: [natSource],
      devices: [natDevice],
    })).toMatchObject({ sourceId: 20, deviceId: 10, matchType: "source_hostname" });
  });

  it("matches device names case-insensitively when NAT rewrites source IP", () => {
    expect(matchSyslogSource({
      sourceIp: "192.168.127.1",
      hostname: "CORE-SW01",
      sources: [],
      devices: [natDevice],
    })).toMatchObject({ sourceId: null, deviceId: 10, matchType: "device_name" });
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
