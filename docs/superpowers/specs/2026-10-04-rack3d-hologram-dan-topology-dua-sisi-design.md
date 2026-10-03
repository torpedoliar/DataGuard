# Rack3D: Hologram Device + Topology isi dari satu sisi (Replace)

**Date:** 2026-10-04
**Status:** Approved (brainstorming Q&A, 2026-10-03)
**Scope:** 3D rack view (hologram card) + bidirectional topology write (`updatePort`).

## Problem

1. Topology saat ini ditulis manual dari **dua sisi**: pemakai harus isi port tujuan
   di perangkat A *dan* perangkat B. Ingin isi cukup dari **satu** perangkat asal.
2. Di 3D view, device yang dipilih tidak menampilkan network docs-nya di atas device
   sebagai "hologram" (kartu ringkas seakan melayang di ruang 3D).

## Keputusan yang sudah disetujui

- **Hologram dulu**; panel detail kanan hanya muncul saat dibuka manual (tombol di hologram).
- **Isi dua-duanya**: hologram *dan* form edit jaringan lama sama-sama menulis kedua sisi.
- **Satu dialog**: klik port kosong → satu dialog (pilih target device + target port) → Save.
- **Replace**: link baru menang; port yang tadinya terhubung (di sisi mana pun) dilepas,
  kedua ujung selalu saling menunjuk.
- **Tampilan B**: panel sungguhan di ruang 3D dengan teks lebih terang, dengan semua fungsi
  A (status, audit terakhir, insiden, SIEM, ringkasan port, port bisa diklik, tombol panel).

## Desain

### 1. Topologi: write dua sisi + Replace (root fix di `updatePort`)

DB tidak berubah (`network_ports.connected_to_device_id` + `connected_to_port_id` sudah
mendukung dua sisi; tidak ada migrasi). Perbaikan hanya di action layer.

Semantics baru `updatePort(id, data)`:

1. Ambil port lama (`currentPort`).
2. Guard self-link: `data.connectedToPortId === id` → `throw new Error("Port tidak dapat terhubung ke dirinya sendiri.")`.
3. `newConn` = field `connectedToPortId` bila disediakan; kalau diomiti, tetap `oldConn`
   (perilaku lama dipertahankan — aksi yang tidak menyentuh topologi tidak menghancurkan link).
4. Kalau `oldConn !== newConn`, dalam **satu `db.transaction`**:
   - **Unlink lama (dua arah):**
     - `a` = port ini, `b` = `oldConn`. Bersihkan `a.connectedTo*` (via payload) dan
       `b.connectedTo*`. Ini memperbaiki kasus yang sekarang menghasilkan "ghost link":
       bila `oldConn` menunjuk balik ke port *lain* (bukan id ini), sisi lama itu harus
       dilepas juga, bukan dibiarkan menunjuk stale.
   - **Link baru:**
     - Set port tujuan `newConn`: `{ connectedToDeviceId: data.deviceId, connectedToPortId: id }`.
     - Sebelum menimpanya, lepas **semua** port lain yang backlink ke `newConn`
       (`connectedToPortId = newConn AND id <> id`) dan lepas backlink `newConn` ke
       pasangannya yang lama bila `newConn.connectedToPortId` menunjuk ke port lain.
       Inilah semantik Replace: dua port yang menunjuk ke satu tujuan di-unlink yang lama, yang baru menang.
5. Setelah link, `logAudit` + `revalidatePath` (tetap).

Catatan: `addPort` tetap get the same treatment minimal — bila `connectedToPortId` disediakan,
lepas *semua* backlink lama ke port itu (bukan hanya yang `<> inserted.id`). Semua dalam
transaksi.

Perubahan UI:

- `EditPortModal` (form edit jaringan lama): ganti payload `connectedToPortId` yang sekarang
  mengirim `null` saat device berubah (dan `connectedToDeviceId` saja). Sekarang kirim
  **selalu** `targetDeviceId` + pilihan port tujuan: tambahkan **select "Port tujuan"** di
  form (daftar port device tujuan yang terdaftar di site), simpankan `{ connectedToDeviceId,
  connectedToPortId }`. Dengan begitu isi dari form lama pun menulis dua sisi otomatis.
  - `otherDevices` sudah tersedia di `PortTable`; option port per device tujuan dari
    `getPortsByDevice(targetDeviceId)` (dipakai juga oleh hologram).
- Hologram memakai `updatePort` yang sama — tidak ada action baru.

### 2. Hologram (menggantikan `DeviceFloatCard`)

Rendering: tetap slot `Html` di `RackDevice` (`position [0, h+0.06, FRONT_Z]`, `center`,
`zIndexRange [40,0]`, tanpa `distanceFactor` — pixel tetap, teks cerah; `transform: false`
karena `transform:true` di drei adalah polyfill canvas dengan text canvas, tidak dipakai
sebelumnya di repo dan mengganggu klik di ruang 3D). Kartu = DOM di atas device, persis
seperti yang sudah terbukti di komit `520e754` ("Html polos tanpa distanceFactor").

**DeviceHologram** (komponen baru; ganti file `device-float-card.tsx`):
- Header: nama device (font-bold, text-ops-text), IP (mono, text-ops-muted), tombol close X.
- Body: ringkasan +
  - Badge status: dot warna status (`OK` hijau / `NOT OK` merah / `Pending` abu).
  - Audit terakhir: dari `getDeviceDrawer(device.id)` → `lastAudit`; merender tanggal.
  - Insiden terbuka: dari `openIncidents` di RackDevice (sudah ada per device).
  - SIEM: dari `drawer` → `siem.count`/`latest` (bila tersedia — label "SIEM" vertikal di kiri
    kartu, reusable dari `device-drawer-sections`).
  - Ringkasan port: `N/N linked` (sensasi kabel di ruang 3D).
  - Daftar port: setiap port = tombol baris (pixel ratio memadai: min-h 36px). Port yang
    **terkait** (`connectedToDeviceId != null`) → teks "→ Device :Port", klik = `View peer`
    → `onSelectPeer(peerDeviceId)` memunculkan target di sebelah *kiri* hologram (panel detail
    kanan sudah memakai sisi kanan). Port yang **kosong** → klik = buka dialog isi tujuan.
- Footer: tombol **"Full Docs"** (buka `/admin/devices/{id}/network`) + tombol
  **"Panel"** → `onOpenPanel()` → buka `DeviceDetailPanel` docked di kanan.
- Dialog "Isi tujuan" (satu dialog): select **Target Device** (dari `otherDevices` —
  semua device site aktif) + select **Target Port** (port dari `getPortsByDevice(deviceTujuan)`)
  + tombol Save. Save → `updatePort(portSumber.id, { deviceId, connectedToDeviceId:
  targetDeviceId, connectedToPortId: targetPortId })` → replace + dual-write otomatis.
  Setelah save: refresh daftar port, kartu target otomatis muncul di sebelah (karena
  `getPortsByDevice` hasil baru akan menunjuk ke sana, dan klik/View menuju ke sana).
  Loading & error inline (teks kecil merah bila gagal).

Data & wiring:

- `RackView3D` sudah fetch `cardPorts` via `getPortsByDevice` — dipakai hologram.
- `onSelectPeer(peerId)` sudah ada di shell (`selectPeer`) — perangkat peer yang ada di rack
  akan dipilih dan fly-to; jika tidak ada di rack site, tombol fallback ke "Full Docs".
- Target device yang muncul "di sebelah": karena laci kanan sudah dipakai `DeviceDetailPanel`,
  kartu peer ditempatkan di **kiri** (lihat gambar intensi: untuk sekarang targetnya muncul
  begitu Anda klik).
- Komponen `create`/`delete`: tidak ada. `DeviceFloatCard` lama dihapus; file test lama
  di-update mengikuti struktur baru.

### 3. Files yang diubah

| File | Perubahan |
|---|---|
| `actions/network.ts` | `updatePort`: transaksi, unlink dua arah + Replace; `addPort`: lepas semua backlink lama ke tujuan dalam transaksi. |
| `actions/network.test.ts` | Update 3 test lama (payload baru: `connectedToPortId` selalu dikirim), tambah test Replace + ghost-link + transaksi. |
| `components/admin/edit-port-modal.tsx` | Select "Port tujuan" (daftar port device tujuan), payload selalu `{ connectedToDeviceId, connectedToPortId }`. |
| `components/rack3d/device-float-card.tsx` | Ganti jadi **DeviceHologram** + dialog isi tujuan + peer label. |
| `components/rack3d/device-float-card.test.tsx` | Update mengikuti komponen baru. |
| `components/rack3d/rack-view-3d.tsx` | Wire `onOpenPanel`, `onSelectPeer` kiri, refresh list setelah save; top-nav sudah handle `cardDevice`. |
| `components/admin/device-drawer-sections.tsx` | Tidak diubah (reuse `useDeviceDrawer`). |

### 4. Error handling

- Select port tujuan kosong → blok tombol save + pesan "Pilih port tujuan".
- `updatePort` gagal (unauthorized, port tujuan dihapus) → error inline di dialog, tidak menutup.
- `getPortsByDevice` gagal → daftar port kosong + teks coba lagi; hologram tetap tampil.

### 5. Testing

- `actions/network.test.ts`: 5+ test baru untuk Replace & dua arah.
- `device-float-card.test.tsx`: update render hologram (port wired menunjukkan peer;
  port kosong membuka dialog; save memanggil updatePort dengan pasangan lengkap).
- Suite gate: `npm run test`, `npm run lint`, `npm run typecheck`.

## Non-goals

- Tidak ada migrasi DB.
- Tidak ada perubahan schema.
- Tidak ada animasi hologram (brightness/scanline) — kebutuhan visual B dipenuhi lewat
  styling cerah kontras tinggi; pola listrik/model 3D jadi prioritas berikutnya bila diminta.