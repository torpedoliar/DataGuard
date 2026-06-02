# Phase 07 - Human-Readable Analysis

## Objective

Turn SIEM findings into clear operator-readable explanations and recommended actions.

## Deliverables

- rule-based analysis templates
- recommended-action templates
- finding detail UI sections
- tests for template output

## Analysis structure

Every finding should have:

1. What happened
2. Affected asset/site
3. Evidence summary
4. Likely impact
5. Possible causes
6. Recommended actions

## Template examples

### Interface flap

```text
{deviceName} mengalami interface flap pada {interfaceName} sebanyak {eventCount} kali dalam {windowMinutes} menit.

Dampak:
Koneksi perangkat pada interface tersebut bisa intermittent.

Kemungkinan penyebab:
- kabel atau SFP bermasalah
- peer device restart
- power issue di perangkat lawan
- speed/duplex mismatch

Langkah:
1. Cek kabel dan SFP.
2. Cek log peer device.
3. Cek CRC/error counter.
4. Monitor apakah flap berulang.
```

### Failed login spike

```text
Terdapat {eventCount} percobaan login gagal ke {deviceName} dari {srcIp} dalam {windowMinutes} menit.

Dampak:
Ini bisa menandakan brute force atau kredensial yang salah digunakan berulang.

Langkah:
1. Verifikasi apakah {srcIp} milik admin/internal.
2. Cek username yang dicoba.
3. Blokir sumber jika tidak dikenal.
4. Rotasi password jika ada indikasi kompromi.
```

### Config changed

```text
Konfigurasi perangkat {deviceName} berubah pada {eventTime}.

Dampak:
Perubahan konfigurasi bisa memengaruhi konektivitas, keamanan, atau availability.

Langkah:
1. Verifikasi siapa yang melakukan perubahan.
2. Cocokkan dengan maintenance/change request.
3. Review konfigurasi terbaru.
4. Rollback jika perubahan tidak sah.
```

## Evidence formatting

Finding detail should show:
- first seen
- last seen
- count
- top source IPs
- top usernames
- affected interface
- sample raw event lines

## Tests

- interface flap template includes device, interface, count, and action.
- failed login template includes source IP and username if available.
- missing optional data uses safe fallback, not `undefined`.
- raw message snippets are escaped in UI.

## Acceptance criteria

- Findings are understandable without reading raw syslog.
- Recommended action appears for all default rules.
- Evidence links back to sample events.
