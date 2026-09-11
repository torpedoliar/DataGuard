# 02: NCM write scopes: switches/credentials/schedules/baselines + trigger backup

**What to build:**
DataGuard bisa mengelola penuh NCM lewat API: CRUD switch, set/update kredensial switch (plaintext diterima sekali, disimpan terenkripsi DPAPI, tidak ada endpoint read-back), ubah jadwal backup, buat golden baseline dari backup terakhir, dan trigger backup on-demand per switch. Semua lewat API key dengan write scope yang sesuai (`switches:write`, `credentials:write`, `schedules:write`, `baselines:write`, `backup:write`).

**Blocked by:** 1: NCM scoped API keys + combined auth.

**Status:** done (NCM `33df745`; salinan brief sisi DG, status otoritatif di repo NCM)

- [x] CRUD switch via API key `switches:write`; tanpa scope = 403.
- [x] Set/update kredensial menerima plaintext sekali jalan; tersimpan terenkripsi; TIDAK ADA endpoint yang mengembalikan plaintext (audit: aksi tercatat tanpa nilai).
- [x] Update jadwal via `schedules:write`; buat baseline via `baselines:write`.
- [x] Trigger backup on-demand via `backup:write`.
- [x] Semua operasi tulis tercatat di audit log NCM (tanpa nilai password).
