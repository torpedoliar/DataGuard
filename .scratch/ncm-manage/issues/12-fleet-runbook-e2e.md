# 12: Runbook + e2e probe fleet

**What to build:** Runbook diperbarui dengan pengoperasian fleet (jadwal heartbeat, arti status offline, cara menambah site baru, troubleshooting site offline), dan probe kontrak e2e diperluas: mematikan NCM tiruan → heartbeat menandai offline + insiden + Telegram (mock) → menyalakan lagi → pulih.

**Blocked by:** 09, 10, 11.

**Status:** ready-for-agent

- [ ] Runbook mencakup operasi fleet + troubleshooting offline.
- [ ] Probe e2e fleet hijau melawan NCM sungguhan (siklus offline→online).
- [ ] Commit.
