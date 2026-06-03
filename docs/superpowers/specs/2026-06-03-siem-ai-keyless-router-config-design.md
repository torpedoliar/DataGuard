# SIEM AI — Koneksi Keyless ke API Router (Konsep ala Claude CLI)

- **Tanggal:** 2026-06-03
- **Status:** Disetujui (siap masuk tahap rencana implementasi)

## Latar Belakang

Saat ini fitur SIEM AI Analysis **mewajibkan API key**. Di `actions/siem-ai.ts`, analisis ditolak bila key kosong:

```ts
if (!endpointUrl || !apiKey.trim() || !model)
  return { message: "SIEM AI endpoint, API key, and model must be configured." };
```

Request selalu mengirim header `Authorization: Bearer ${apiKey}` (`lib/siem/ai-analysis.ts`).

Pengguna ingin konsep seperti **Claude CLI**: cukup mengarahkan aplikasi ke sebuah **API router** (mis. 9router / LiteLLM / proxy lokal) dan **memilih satu model bebas**, **tanpa perlu mengisi API key** di aplikasi — karena router yang memegang kredensial provider.

## Tujuan

1. **API key menjadi opsional.** Router memegang kredensialnya sendiri. Aplikasi cukup mengirim `endpoint + model`. Header `Authorization` **hanya dikirim bila key diisi**.
2. **Satu field model bebas.** Mengganti 4 field model (Default/Opus/Sonnet/Haiku) menjadi satu input "Model".

## Non-Tujuan (YAGNI)

- Tidak menambah dropdown daftar model dari `/v1/models` router.
- Tidak mengubah alur redaksi, pembuatan prompt, atau parsing respons.
- Tidak mengubah skema autentikasi pengguna aplikasi (admin auth tetap).

## Keputusan Desain

### Pemilihan model
Pakai **kolom tunggal**: pertahankan `ai_default_model` sebagai satu-satunya kolom model dan **drop** `ai_model_opus`, `ai_model_sonnet`, `ai_model_haiku`. Alternatif (dropdown `/v1/models`, atau menyembunyikan kolom di UI tanpa drop) ditolak demi kebersihan dan kesederhanaan.

### Autentikasi ke router
Router memegang kredensial sendiri. Aplikasi **tidak mengirim** header `Authorization` saat key kosong. Saat key diisi (router yang dilindungi token), header tetap dikirim `Bearer <key>`.

## Perubahan per Komponen

### 1. Database — `db/schema.ts` + migrasi Drizzle baru
- Drop kolom: `ai_model_opus`, `ai_model_sonnet`, `ai_model_haiku`.
- Pertahankan `ai_default_model` (peran "Model"). `ai_api_key` tetap nullable (sudah).
- Buat file migrasi Drizzle baru untuk `DROP COLUMN` ketiga kolom tersebut.

### 2. Request layer — `lib/siem/ai-analysis.ts`
- `requestSiemAiAnalysis`: parameter `apiKey` menjadi opsional (`string | null | undefined`). Bangun header secara kondisional — sertakan `Authorization: Bearer <key>` **hanya** jika key non-kosong setelah trim.
- Hapus `resolveSiemAiModel` (rantai fallback opus→sonnet→haiku). Resolusi model jadi tunggal: trim `aiDefaultModel`, kembalikan `null` bila kosong.
- Update tipe `SiemAiSettingsInput`: hapus `aiModelOpus`, `aiModelSonnet`, `aiModelHaiku`.

### 3. Server action analisis — `actions/siem-ai.ts`
- Ubah guard menjadi: `if (!endpointUrl || !model) return { message: "SIEM AI endpoint dan model harus dikonfigurasi." }`. **Key tidak lagi wajib.**
- Resolusi model dari `process.env.SIEM_AI_DEFAULT_MODEL || settings.aiDefaultModel`.
- Env override: `SIEM_AI_API_KEY` tetap didukung namun opsional; hapus penggunaan `SIEM_AI_MODEL_OPUS/SONNET/HAIKU`, cukup `SIEM_AI_DEFAULT_MODEL`.
- `apiKey` diteruskan apa adanya (boleh kosong) ke `requestSiemAiAnalysis`.

### 4. Settings action — `actions/siem-settings.ts`
- Zod `aiSettingsSchema`: hapus `aiModelOpus`, `aiModelSonnet`, `aiModelHaiku`. `aiDefaultModel` tetap wajib (min 1). `aiApiKey` tetap opsional.
- `getSiemAiSettings`: hapus field model tier dari objek balikan; pertahankan `aiApiKeyConfigured` (untuk indikator opsional) atau ganti sesuai UI baru.
- `updateSiemAiSettings`: hapus persistensi kolom model tier.

### 5. UI form — `components/admin/siem-ai-settings-form.tsx`
- Hapus tiga input model (Opus/Sonnet/Haiku); sisakan satu input **"Model"** (sebelumnya "Default Model").
- Field **API Key**: tandai opsional — placeholder "Kosongkan jika router sudah memegang kredensial".
- Badge status: ganti dari "API key configured/missing" menjadi indikator berbasis kesiapan endpoint + model (mis. "Siap" jika endpoint & model terisi), karena key bukan lagi penentu kesiapan.
- Update tipe `SiemAiSettingsData` agar selaras (hapus field model tier).

### 6. Tests — `lib/siem/ai-analysis.test.ts`
- Hapus test `resolveSiemAiModel` (fungsi dihapus).
- Tambah test untuk `requestSiemAiAnalysis`:
  - **Tanpa key:** header request **tidak** memuat `Authorization`.
  - **Dengan key:** header request memuat `Authorization: Bearer <key>`.
  - Gunakan `fetchFn` mock yang sudah tersedia di signature.
- Pertahankan test `normalizeOpenAiCompatibleEndpoint`, `buildSiemAiPrompt`, `normalizeSiemAiAnalysis`.

## Alur Data (tidak berubah)

redaksi teks → build prompt → POST ke endpoint OpenAI-compatible → parse `choices[0].message.content` (JSON) → normalisasi → simpan ke `siemFindings.aiAnalysis`.

Satu-satunya perubahan alur: header `Authorization` menjadi kondisional, dan model tunggal.

## Penanganan Error

- Endpoint atau model kosong → pesan "SIEM AI endpoint dan model harus dikonfigurasi." (tanpa menyebut API key).
- Router menolak request (mis. butuh token tapi key kosong) → tetap ditangkap oleh `if (!response.ok) throw new Error("AI provider rejected request.")` dan ditampilkan sebagai kegagalan provider.

## Strategi Pengujian

- Unit test `lib/siem/ai-analysis.test.ts` (Vitest) untuk header kondisional + helper yang dipertahankan.
- Verifikasi manual: simpan setting dengan key kosong + model bebas, jalankan generate analysis terhadap router lokal.
- Jalankan migrasi Drizzle pada DB dev dan pastikan kolom ter-drop tanpa error.

## Risiko & Mitigasi

- **Kehilangan data kolom model tier saat drop:** kolom tersebut redundan terhadap `ai_default_model` yang sudah jadi sumber utama; tidak ada data unik yang hilang secara fungsional.
- **Server yang menolak Bearer kosong:** justru diselesaikan oleh perubahan ini (header dihilangkan saat kosong), bukan dikirim kosong.
