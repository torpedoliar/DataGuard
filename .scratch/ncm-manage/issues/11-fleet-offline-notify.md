# 11: Notifikasi Telegram saat site offline

**What to build:** Saat heartbeat menyatakan sebuah site OFFLINE (dan saat site kembali online), DG mengirim notifikasi Telegram ke admin site tersebut — memakai kembali jalur fan-out Telegram yang sudah dipakai ingest webhook, bukan membangun pengirim baru.

**Blocked by:** 09 (butuh sinyal transisi online↔offline dari heartbeat).

**Status:** ready-for-agent

- [ ] Transisi ke OFFLINE → pesan Telegram (site, sejak kapan, last_seen terakhir).
- [ ] Transisi kembali ONLINE → pesan pemulihan.
- [ ] Tidak ada spam: satu pesan per transisi (flapping dijinakkan).
- [ ] Test hijau + commit.
