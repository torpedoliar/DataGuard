# 01: NCM scoped API keys + combined auth

**What to build:**
Admin NCM dapat membuat API key dengan scope granular dari UI/API NCM. Key berscope `read` membuka endpoint read (GET switches/backups/reviews); key TANPA scope tetap hanya bisa network-doc — tidak ada regresi untuk integrasi DataGuard yang ada. Auth dependency gabungan JWT-atau-API-key dipasang di semua router yang relevan.

**Blocked by:** None (can start immediately).

**Status:** done (NCM `4beb5ef`; salinan brief sisi DG, status otoritatif di repo NCM)

- [x] Model API key punya kolom `scopes` (list scope). (KNOWN_SCOPES 8 scope di repository.py.)
- [x] Matrix test scope×endpoint: key tiap scope vs tiap endpoint — hasil sesuai desain (hijau). (test_scoped_api_keys.py.)
- [x] Key lama (tanpa kolom scope / kosong) berperilaku persis seperti sekarang (hanya network-doc) — regresi test hijau. (Catatan tiket 16: kemudian diperketat, legacy key 403 juga di network-doc.)
- [x] Endpoint read mengembalikan 403 tanpa scope `read`; 200 dengan scope `read`.
