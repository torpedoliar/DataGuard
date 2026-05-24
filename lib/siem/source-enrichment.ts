export type SourceCandidate = { id: number; siteId: number | null; deviceId: number | null; sourceIp: string; hostname: string | null; vendor: string; parserProfile: string };
export type DeviceCandidate = { id: number; siteId: number | null; name: string; ipAddress: string | null; assetCode: string | null; categoryName: string | null; brandName: string | null; locationName: string | null; rackName: string | null; rackPosition: number | null; zone: string | null };
export type SiteCandidate = { id: number; name: string; code: string };

export function matchSyslogSource(input: { sourceIp: string; hostname: string | null; sources: SourceCandidate[]; devices: DeviceCandidate[] }) {
  const sourceByIp = input.sources.find((source) => source.sourceIp === input.sourceIp);
  if (sourceByIp) return { sourceId: sourceByIp.id, siteId: sourceByIp.siteId, deviceId: sourceByIp.deviceId, vendor: sourceByIp.vendor, parserProfile: sourceByIp.parserProfile, matchType: "source_ip" as const };

  const deviceByIp = input.devices.find((device) => device.ipAddress === input.sourceIp);
  if (deviceByIp) return { sourceId: null, siteId: deviceByIp.siteId, deviceId: deviceByIp.id, vendor: "generic", parserProfile: "generic", matchType: "device_ip" as const };

  const sourceByHostname = input.hostname ? input.sources.find((source) => source.hostname === input.hostname) : null;
  if (sourceByHostname) return { sourceId: sourceByHostname.id, siteId: sourceByHostname.siteId, deviceId: sourceByHostname.deviceId, vendor: sourceByHostname.vendor, parserProfile: sourceByHostname.parserProfile, matchType: "source_hostname" as const };

  const deviceByName = input.hostname ? input.devices.find((device) => device.name === input.hostname) : null;
  if (deviceByName) return { sourceId: null, siteId: deviceByName.siteId, deviceId: deviceByName.id, vendor: "generic", parserProfile: "generic", matchType: "device_name" as const };

  return { sourceId: null, siteId: null, deviceId: null, vendor: "generic", parserProfile: "generic", matchType: "unknown" as const };
}

export function buildAssetMetadata(input: { site: SiteCandidate | null; device: DeviceCandidate | null }) {
  return {
    siteName: input.site?.name ?? null,
    siteCode: input.site?.code ?? null,
    deviceName: input.device?.name ?? null,
    assetCode: input.device?.assetCode ?? null,
    category: input.device?.categoryName ?? null,
    brand: input.device?.brandName ?? null,
    location: input.device?.locationName ?? null,
    rack: input.device?.rackName ?? null,
    rackPosition: input.device?.rackPosition ?? null,
    zone: input.device?.zone ?? null,
  };
}
