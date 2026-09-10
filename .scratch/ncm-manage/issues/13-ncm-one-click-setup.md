# 13: Setup NCM 1 form + HMAC auto-generate (efisiensi UI)

**Latar:** User: 1 API key NCM saja harusnya cukup; form DG kebanyakan; HMAC harus jelas asalnya. Jawaban desain: benar cukup 1 key (admin key semua scope; DG selalu pakai key tersimpan itu). HMAC di-generate DG (crypto random), bukan NCM — NCM hanya verifikasi. Tombol "Setup Otomatis (1 klik)" melakukan generate → simpan terenkripsi → push ke NCM (auto-sync) dalam satu aksi.

**Blocked by:** 08 (saveNcmWebhook + setNcmWebhook sudah ada).

**Status:** done (commit di bawah)

- [x] `lib/ncm-setup.ts`: generateWebhookSecret (32 byte base64url), resolveIngestUrl (DG_PUBLIC_URL/NEXT_PUBLIC_APP_URL), requiredDgScopes (8 scope).
- [x] `setupNcmWebhook`: generate → push PATCH notify-settings (system:write) → simpan terenkripsi; NCM auto-sync saat aksi sukses.
- [x] UI: tombol Setup Otomatis (1 klik) + Simpan Manual; teks form diperjelas (cukup 1 key).
- [x] Test: `lib/ncm-setup.test.ts` 3 passed; regresi hijau (716/716 file terkait, tsc 0, build OK).
