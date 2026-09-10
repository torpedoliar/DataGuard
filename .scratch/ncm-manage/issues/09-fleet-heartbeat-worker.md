# 09: Heartbeat worker DG + last_seen per site

**What to build:** DG tahu tiap site NCM hidup atau mati tanpa menunggu webhook. Worker heartbeat memanggil tiap site NCM yang terkonfigurasi (interval default 5 menit), mencatat waktu kontak terakhir per site, dan bila sebuah site tidak menjawab berulang kali maka site ditandai OFFLINE dan insiden High dibuat otomatis. Ada tombol "check now" per site di UI untuk memicu heartbeat manual.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Heartbeat memanggil tiap site NCM terkonfigurasi dan menyimpan last_seen per site.
- [ ] Site yang tak menjawab berulang → status OFFLINE + insiden High otomatis.
- [ ] Tombol check-now per site di UI pengaturan NCM.
- [ ] Test hijau (heartbeat sukses/gagal/offline-threshold) + commit.
