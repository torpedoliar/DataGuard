export type NormalizedSyslogEvent = {
  category: string | null;
  normalizedType: string | null;
  action: string | null;
  outcome: string | null;
  srcIp: string | null;
  srcPort: number | null;
  dstIp: string | null;
  dstPort: number | null;
  username: string | null;
  interfaceName: string | null;
  protocol: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
};

export function emptyNormalizedEvent(): NormalizedSyslogEvent {
  return { category: null, normalizedType: null, action: null, outcome: null, srcIp: null, srcPort: null, dstIp: null, dstPort: null, username: null, interfaceName: null, protocol: null, tags: [], metadata: {} };
}
