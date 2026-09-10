# 11: Notifikasi Telegram saat site offline

**What to build:** Saat heartbeat menyatakan sebuah site OFFLINE (dan saat site kembali online), DG mengirim notifikasi Telegram ke admin site tersebut — memakai kembali jalur fan-out Telegram yang sudah dipakai ingest webhook, bukan membangun pengirim baru.

**Blocked by:** 09 (butuh sinyal transisi online↔offline dari heartbeat).

**Status:** done (commit 1736bd5)

- [x] Transisi ke OFFLINE → pesan Telegram (site, sejak kapan, last_seen terakhir).
- [x] Transisi kembali ONLINE → pesan pemulihan.
- [x] Tidak ada spam: satu pesan per transisi (flapping dijinakkan).
- [x] Test hijau + commit.
