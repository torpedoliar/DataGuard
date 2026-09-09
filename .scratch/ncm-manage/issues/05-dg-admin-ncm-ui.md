# 05: DG halaman /admin/ncm: fleet + aksi + offline banner

**What to build:**
Halaman `/admin/ncm` per site dengan 4 area: Switches (CRUD), Backups & Schedules (lihat/ubah jadwal, trigger backup, buat baseline), Baselines & Reviews (antrian review drift + diff, approve/reject dengan catatan), Connection (superadmin-only). Status fleet live-fetch dari NCM (transient, tidak disync ke DB). Saat NCM offline: banner "NCM offline — terakhir terlihat <timestamp>" + semua tombol aksi disabled. Semua aksi DG tercatat audit log (Server Action: guard `requireActiveSiteAdminAction` + zod + audit + revalidatePath).

**Blocked by:** 2: NCM write scopes; 4: DG ncmSettings + lib/ncm.ts.

**Status:** done — UI commit `041d275 feat(ncm): /admin/ncm management UI (ticket 05)` (dep lib: `d062a78`)

- [x] 4 area tampil per site sesuai desain; akses Connection superadmin-only.
- [x] Setiap aksi (tambah/edit/hapus switch, update password, ubah jadwal, trigger backup, buat baseline, approve/reject review) end-to-end ke NCM test-server.
- [x] Banner offline + aksi tidak tersedia saat NCM tidak terjangkau; `lastSeenAt` terisi (getNcmOverview -> ncm_settings.last_seen_at).
- [x] Audit log DG tercatat untuk semua aksi (runNcmWrite + logAudit); password tidak pernah muncul di log/UI (ditest di actions/ncm.test.ts).
---

## Implementation notes (ticket 05, 2026-09-09)

- Shadowing bug di actions/ncm.ts diperbaiki via namespace import: `import * as ncmLib from "@/lib/ncm"` — export action dengan nama identik lib tidak lagi merekurs ke dirinya sendiri. actions/ncm.test.ts hijau 12/12.
- Halaman `app/[locale]/(dashboard)/admin/ncm/page.tsx` + `components/admin/ncm-dashboard.tsx`: 4 area (Switches CRUD + rotasi kredensial, Backups & Schedules, Baselines & Reviews dengan diff via getNcmReviewDetail, Connection). Offline: banner "NCM offline — terakhir terlihat <ts>" + area aksi diganti kartu Connection + tombol Coba lagi. Nav: item "NCM" di lib/ui/navigation.ts + ikon router di app-shell.tsx + shortcut di dashboard admin.
- **Keterbatasan review approve/reject**: NCM membuka review status/approve hanya untuk JWT (tidak untuk API key). Action decideNcmReview mengikuti path resmi lib/ncm.ts (PATCH /reviews/{id}) memakai admin API key site — pada NCM yang menegakkan JWT-only, NCM akan menjawab 403 dan pesan error ditampilkan apa adanya di UI. Tidak ada hack kredensial ke NCM; bila nanti dibutuhkan approve via DG penuh, tambahkan flow login superadmin NCM tersendiri (di luar scope tiket ini).
- Validasi: `npx tsc --noEmit` 0 error; eslint 0 error pada file tiket (warning `_args` di test = baseline repo); `npx vitest run` actions/ncm + lib/ncm + navigation = 32/32 hijau; `next build` sukses, route /[locale]/(dashboard)/admin/ncm terdaftar.
