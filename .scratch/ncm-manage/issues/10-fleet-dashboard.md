# 10: Dashboard fleet lintas-site + badge nav

**What to build:** Satu halaman fleet di DG yang menampilkan semua site NCM dalam satu layar: badge per site (online/offline + jumlah drift terbuka) dan satu tabel berisi semua review drift yang masih terbuka lintas site, sehingga admin multi-site tidak perlu membuka tiap site satu per satu.

**Blocked by:** 09 (butuh last_seen + status offline per site).

**Status:** ready-for-agent

- [ ] Halaman fleet menampilkan badge per site: online/offline + drift count.
- [ ] Satu tabel drift terbuka lintas site (klik baris → detail review site terkait).
- [ ] Badge agregat di navigasi (jumlah site offline / drift terbuka).
- [ ] Test hijau + commit.
