# Ticket 05 — Admin NCM UI: halaman /admin/ncm per site, 4 area, offline banner, aksi tulis ke NCM

Date: 2026-09-09
Status: implemented

## Goal

Halaman `/admin/ncm` per site aktif dengan 4 area — Switches (CRUD), Backups &
Schedules (lihat/ubah jadwal, trigger backup, buat baseline), Baselines &
Reviews (antrian review drift + diff, approve/reject dengan catatan), Connection
(superadmin-only, link ke form tiket 04 di /admin/settings). Status fleet
live-fetch dari NCM (transient — tidak ada tabel sinkron baru). NCM offline →
banner "NCM offline — terakhir terlihat <timestamp>" dan semua aksi tidak
tersedia (tampil offline + coba lagi, tanpa antrean). Semua tulis lewat Server
Action pattern repo: guard `requireActiveSiteAdminAction` + zod + audit +
`revalidatePath`.

## Approach — perluas lib/ncm.ts, satu file actions, satu page + satu client component

1. **`lib/ncm.ts`** (jangan pindah Rumah, perluas saja):
   - Generalisasi `ncmGet` privat → `ncmRequest(config, method, path, body?)`
     dengan method POST/PATCH/DELETE + body JSON (`Content-Type:
     application/json`). Mapping error & timeout 10s tetap sama (test lama
     harus tetap hijau).
   - Wrapper tulis satu baris per endpoint tiket 02:
     `createNcmSwitch` / `updateNcmSwitch` / `deleteNcmSwitch`
     (switches:write), `createNcmCredentials` / `updateNcmCredentials` /
     `deleteNcmCredentials` (credentials:write), `createNcmJob` /
     `updateNcmJob` / `deleteNcmJob` (schedules:write), `createNcmBaseline` /
     `refreshNcmBaseline` / `deleteNcmBaseline` (baselines:write),
     `triggerNcmBackup` (POST /switches/{id}/backup, backup:write),
     `fetchNcmReview` (GET /reviews/{id}), `decideNcmReview` (PATCH
     /reviews/{id}, approve/reject + catatan), `fetchNcmReviewRollback` (GET
     /reviews/{id}/rollback, scope read).
   - Wrapper baca baru yang UI perlukan: `fetchNcmJobs` (GET jobs),
     `fetchNcmBaselines` (GET baselines).
   - `getNcmLastSeen(siteId): Promise<Date | null>` — baca heartbeat
     `ncm_settings.last_seen_at` untuk banner offline.
2. **`actions/ncm.ts`** (baru, "use server"; jangan menyentuh
   `actions/ncm-settings.ts`):
   - `getNcmOverview()` — guard admin site aktif; resolve config; belum
     dikonfigurasi → `{ status: "unconfigured", message }`; live-fetch
     switches+jobs+backups+baselines+reviews (`Promise.all`, gagal satu →
     offline), sukses → heartbeat `touchNcmLastSeen`, kembalikan record apa
     adanya (JSON polos, serializable). NCM offline →
     `{ status: "offline", lastSeenAt (ISO), error }`. Tidak ada sync ke DB.
   - Satu runner privat `runNcmAction({action, entity, entityId, entityName,
     detail}, run)`: guard + resolve config + try lib call → audit + 
     `revalidatePath("/admin/ncm")`; error NCM → `{ message }` (pesan
     "Gagal terhubung..." dari lib).
   - Actions form (prevState, formData): `addNcmSwitch`, `updateNcmSwitch`,
     `deleteNcmSwitch`, `rotateNcmCredentials`, `updateNcmSchedule`,
     `triggerNcmBackup`, `createNcmBaseline`, `decideNcmReview`.
   - **Password tidak pernah masuk log/audit/response**: zod menerima
     password, diteruskan ke NCM, audit detail hanya teks faktual
     ("Kredensial switch {id} diperbarui (nilai tidak dicatat)"), pesan sukses
     generik.
   - `getNcmReviewDetail(id)` — guard admin + fetchNcmReview untuk diff modal.
   - AuditEntity union (`lib/audit.ts`) ditambah: `ncm_switch`, `ncm_schedule`,
     `ncm_backup`, `ncm_baseline`, `ncm_review`.
3. **`app/[locale]/(dashboard)/admin/ncm/page.tsx`** — guard session
   admin/superadmin + activeSiteId (pola halaman network-docs), metadata,
   `PageHeader`, render `NcmDashboard`.
4. **`components/admin/ncm-dashboard.tsx`** ("use client", satu file):
   - unconfigured → kartu notice + link /admin/settings (superadmin).
   - offline → banner merah "NCM offline — terakhir terlihat <ts>" + tombol
     Coba lagi (router.refresh) + area Connection; tidak ada form aksi sama
     sekali (lebih kuat dari sekadar disabled).
   - online → 4 area: Switches (tabel + add/edit/delete/rotate kredensial),
     Backups & Schedules (jadwal + edit enabled/schedule; daftar backup +
     trigger per switch; buat baseline dari backup), Baselines & Reviews
     (daftar baseline; antrian review + muat diff + approve/reject + catatan),
     Connection (URL + lastSeen + link settings superadmin-only).
   - Render tahan bentuk: helper `pick(row, ...keys)` untuk nama field NCM
     yang bisa bervariasi (switch_id/switchId, dst).
   - i18n: string Indonesia hardcoded (preseden network-docs — out of scope
     di SPEC).
5. **Nav** (`lib/ui/navigation.ts`): item `/admin/ncm` di adminItems (label
   "NCM", ikon `router`) + mapping ikon di `components/ui/app-shell.tsx`.
   Test navigasi diperbarui.
6. **Tests (TDD red → green)**:
   - `lib/ncm.test.ts` — tambah: POST mengirim body JSON + Content-Type ke
     path benar; DELETE method; path /switches/{id}/backup; error status
     non-OK di path tulis; `getNcmLastSeen`.
   - `actions/ncm.test.ts` — mock `@/lib/action-auth`, `@/lib/ncm`,
     `@/lib/audit`, `next/cache` (pola siem-settings.test.ts): guard tolak
     tanpa admin; belum dikonfigurasi → message tanpa memanggil NCM; sukses →
     lib dipanggil + audit + revalidate; NCM error → message; **audit detail
     rotate kredensial tidak mengandung password**; getNcmOverview offline &
     online & unconfigured.

## Skipped (lazy / YAGNI)

- UI refresh/delete baseline & delete job & POST credentials awal: wrapper lib
  ada (tiket 02), UI cukup kebutuhan 4 area — tambah saat diminta.
- Antrean perintah offline: out of scope SPEC (offline → coba lagi).
- Sinkronisasi status fleet ke DB: transient, live-fetch saja.
- i18n halaman baru: string Indonesia hardcoded (preseden network-docs).

## Validation

`npm run check` (lint + test + build) hijau pada file yang diubah; error
pre-existing di siem*/hive bukan regression. Commit `feat(ncm): ...`, tanpa
push.
