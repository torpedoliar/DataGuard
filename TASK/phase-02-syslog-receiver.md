# Phase 02 - Syslog Receiver UDP 514

## Objective

Add production-grade syslog receiver service listening on UDP 514 and storing raw logs without blocking on heavy processing.

## Deliverables

- `scripts/syslog-receiver.ts`
- npm script `syslog:receiver`
- Docker Compose service exposing UDP 514
- receiver unit tests for message size, source metadata, and raw insert batching
- local sender test script or documented command

## Runtime design

Receiver must be separate from Next.js.

Default listener:
- host: `0.0.0.0`
- UDP port: `514`

Optional environment variables:
- `SYSLOG_UDP_HOST=0.0.0.0`
- `SYSLOG_UDP_PORT=514`
- `SYSLOG_MAX_MESSAGE_SIZE=16384`
- `SYSLOG_BATCH_SIZE=100`
- `SYSLOG_FLUSH_INTERVAL_MS=1000`

## Docker design

Use privileged bind capability, not root-only assumption.

```yaml
syslog-receiver:
  build: .
  command: npm run syslog:receiver
  ports:
    - "514:514/udp"
  cap_add:
    - NET_BIND_SERVICE
  environment:
    DATABASE_URL: ${DATABASE_URL}
    SYSLOG_UDP_PORT: "514"
  depends_on:
    - db
  restart: unless-stopped
```

## Receiver flow

1. Start UDP socket.
2. Receive packet.
3. Capture remote address and port.
4. Validate size.
5. Convert message to UTF-8 safely.
6. Push raw event into in-memory queue.
7. Batch insert into `syslog_events_raw`.
8. Emit counters for received, inserted, dropped, oversized, failed.

## Backpressure behavior

- Use bounded queue.
- If queue full, drop newest or oldest based on setting.
- Increment drop counter.
- Never crash because of burst traffic.
- DB outage should retry with exponential backoff while bounded queue prevents memory blowup.

## Message size policy

- Max default 16KB.
- Oversized messages insert as dropped metadata only if safe, or drop with counter.
- Never store unlimited payload.

## Health logging

Every 60 seconds log:
- received count
- inserted count
- dropped count
- parse error count
- queue depth

## Test sender

PowerShell example:
```powershell
$udp = New-Object System.Net.Sockets.UdpClient
$bytes = [Text.Encoding]::UTF8.GetBytes('<34>May 22 10:15:30 test-host sshd: Failed password for admin from 10.10.1.25 port 22 ssh2')
$udp.Send($bytes, $bytes.Length, '127.0.0.1', 514)
$udp.Close()
```

## Tests

- Starts with configured host/port.
- Stores remote IP and source port.
- Rejects oversized payload.
- Batches raw inserts.
- Does not call parser inline in receive callback.

## Acceptance criteria

- Receiver listens on UDP 514.
- Test packet creates row in `syslog_events_raw`.
- Receiver survives malformed input.
- Receiver can be run under Docker Compose.
