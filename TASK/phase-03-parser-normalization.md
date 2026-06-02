# Phase 03 - Parser and Normalization Engine

## Objective

Parse raw syslog into structured events and normalize vendor/generic messages into consistent SIEM event types.

## Deliverables

- `lib/siem/syslog-parser.ts`
- `lib/siem/normalizers/generic.ts`
- `lib/siem/normalizers/mikrotik.ts`
- `lib/siem/normalizers/cisco.ts`
- `lib/siem/normalizers/fortigate.ts`
- `lib/siem/normalizers/linux.ts`
- parser tests and fixture samples
- background parse worker or post-insert processor

## Parser support

### RFC3164

Example:
```text
<189>May 22 10:15:30 router01 login: failed password for admin from 10.10.1.20
```

Extract:
- priority
- facility
- severity
- event time
- hostname
- program
- message

### RFC5424

Example:
```text
<34>1 2026-05-22T10:15:30Z host app 123 ID47 - message
```

Extract:
- priority
- version
- timestamp
- hostname
- app name
- process id
- message id
- structured data
- message

### Fallback

If parser fails:
- keep raw message
- set parser `fallback`
- set `ingest_status=parse_failed`
- do not lose raw data

## PRI decoding

Formula:
```text
facility = floor(priority / 8)
severity = priority % 8
```

Severity:
- 0 Emergency
- 1 Alert
- 2 Critical
- 3 Error
- 4 Warning
- 5 Notice
- 6 Informational
- 7 Debug

## Normalized event contract

```ts
type NormalizedSyslogEvent = {
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
```

## Generic normalizer mappings

- failed password, login failed, invalid user -> `auth_failed`
- accepted password, login success -> `auth_success`
- link down, interface down -> `interface_down`
- link up, interface up -> `interface_up`
- denied, drop, blocked -> `firewall_deny`
- reboot, restarted, boot -> `device_reboot`
- configured, config changed, commit -> `config_changed`
- temperature, fan, power -> `hardware_alert`

## Vendor normalizers

### MikroTik

Detect:
- login failure/success
- winbox/ssh/webfig source
- interface up/down
- firewall drop
- DHCP conflict
- route change
- config change

### Cisco

Detect:
- `%LINK-3-UPDOWN`
- `%LINEPROTO-5-UPDOWN`
- `%SEC_LOGIN-4-LOGIN_FAILED`
- `%SYS-5-CONFIG_I`
- `%SYS-5-RESTART`
- spanning tree topology changes
- errdisable
- power/fan/temp warnings

### Fortigate

Detect:
- traffic deny
- admin login
- VPN up/down
- IPS/AV/webfilter event
- HA failover
- config change

### Linux

Detect:
- SSH failed/success
- sudo command
- user add/delete
- service restart
- disk full
- OOM killer
- kernel error

## Processing flow

1. Select unparsed raw events.
2. Parse RFC format.
3. Pick normalizer based on source parser profile/vendor.
4. Insert `syslog_events`.
5. Update raw ingest status.
6. Track parser errors.

## Tests

- RFC3164 parser extracts expected fields.
- RFC5424 parser extracts expected fields.
- PRI decode maps facility/severity correctly.
- Generic failed login normalizes to `auth_failed`.
- Cisco link down normalizes to `interface_down` with interface name.
- Fortigate deny extracts src/dst where present.
- Malformed log still creates fallback event or parse error without crash.

## Acceptance criteria

- Raw event can become normalized event.
- Parser errors are visible but non-fatal.
- Existing app tests pass.
