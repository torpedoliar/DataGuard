# Rack3D: Hologram Faceplate + Peer 3D (dua hologram, tanpa fly-to sekamar)

**Date:** 2026-10-04
**Status:** Approved (brainstorming Q&A, 2026-10-04)
**Scope:** 3D rack view — kartu hologram device, kartu 3D rack peer, penempatan dua hologram.
**Depends on:** `2026-10-04-rack3d-hologram-dan-topology-dua-sisi-design.md` (sudah shipped).

## Problem

1. Hologram device sekarang menampilkan daftar port sebagai `<ul>` yang harus di-scroll.
   Pemakai ingin melihat **faceplate** (kotak port seperti network docs), bukan daftar.
2. Tidak ada cara melihat detail port tanpa membuka form: hover tidak memberi info.
3. Device ujung (peer) yang berada di **lokasi/room lain** tidak bisa dilihat dari view
   sekarang — pemakai harus pindah room lalu mencari rack-nya.
4. Kalau peer ada di **room yang sama**, "fly to" memindahkan kamera dan menghilangkan
   device asal dari konteks — padahal dua-duanya ada di view yang sama.

## Keputusan yang sudah disetujui

- **Faceplate, bukan daftar port.** Hologram menggambar faceplate network docs; hover satu
  slot memunculkan strip info (VLAN + device ujung); klik slot terisi memunculkan panel
  informasi; klik slot kosong membuka dialog link.
- **Hologram dulu, panel lewat tombol** (dipertahankan dari spec sebelumnya).
- **Room sama: jangan fly to.** Dua device sama-sama menampilkan hologram.
- **Dua kartu terpisah, bertingkat** bila posisi U kedua device berdekatan.
- **Room lain: kartu 3D rack peer** muncul di dalam view yang sama (rack + perangkatnya);
  klik kartu itu baru berpindah ke lokasi peer.
- **Satu dialog** untuk link (pilih device tujuan + portnya) — dipertahankan.

## Desain

### 1. Hologram = faceplate (ganti daftar port)

Sumber geometri: `buildFaceplate()` di `lib/faceplate.ts` — sumber yang sama dengan faceplate
2D dan export PDF. Tidak ada geometri baru, tidak ada perubahan DB/action.

- Hologram merender `<svg viewBox={`0 0 ${plate.width} ${plate.height}`}>` dengan satu `<rect>`
  per slot dari `plate.slots`, warna dari `faceplateSlotColors(slot.port)` (hijau Active,
  merah Down, abu kosong, aksen mode Trunk/Routed/LACP) — persis palet faceplate 2D.
- Slot kosong tetap dirender (abu, dengan nomor slot) supaya provisioning dari slot kosong
  masih bisa.
- Device tanpa faceplate dikonfigurasi (`isFaceplateConfigured` false) → hologram jatuh ke
  pesan ringkas "Faceplate belum dikonfigurasi" + tombol ke network docs. Tidak ada grid
  generik (network docs adalah satu-satunya sumber kebenaran port).
- Lebar kartu `w-72` → `w-80` supaya slot 48 port masih nyaman di-hover.
- Port yang tidak bisa dipetakan ke slot (`plate.unplaced`) ditampilkan sebagai baris kecil
  di bawah faceplate dengan jumlahnya, bukan dijatuhkan diam-diam.

### 2. Hover + klik slot

- **Hover slot** → strip satu baris di bawah faceplate memakai `describeSlot(slot)` dari
  `components/admin/device-faceplate.tsx` (fungsi yang sama dengan faceplate 2D, sehingga
  teksnya konsisten dan tidak ada duplikasi format). `describeSlot` diimpor apa adanya;
  tidak dipindah ke `lib/` di pekerjaan ini.
- **Klik slot terisi** → dua hal terjadi bersamaan:
  1. Panel informasi kecil muncul di dalam hologram: nama port, mode, VLAN/trunk, speed,
     media, deskripsi, dan peer (`→ Nama :Port`) + dua tombol: `[Edit link]` (membuka
     `PortLinkDialog` untuk port itu) dan `[Tutup]`.
  2. Aksi peer dijalankan sesuai §3 (hologram kedua bila sekamar, kartu 3D rack peer bila
     beda lokasi).
- **Klik slot kosong** → `PortLinkDialog` (sudah ada, tidak berubah).
- Slot bisa difokus keyboard (`tabIndex`, `role="button"`, `aria-label={describeSlot(slot)}`).

### 3. Aksi peer saat slot terisi diklik

Bergantung lokasi peer:

| Peer | Yang terjadi |
|---|---|
| Room sama | Hologram kedua muncul untuk device peer. **Kamera tidak bergerak.** |
| Room lain | `PeerRackCard` (kartu 3D rack peer) muncul di dalam view yang sama. Kamera tidak bergerak sampai kartu diklik. |
| Tidak ter-rack (`racks` tidak memuat device itu) | Fallback lama: `router.push('/admin/devices/{id}/network')`. |

Tidak ada perubahan pada `onPickPort` di `DeviceHologram` — keputusan room sama / room lain
diambil di `RackView3D`, karena di situlah `racks` (semua rack semua lokasi) tersedia.

### 4. Dua hologram, room sama

- State baru `peerDeviceId: number | null` di `RackView3D`. Diisi **hanya** ketika peer
  berada di room yang sedang tampil; peer di lokasi lain memakai `PeerRackCard` (§7) dan
  tidak mengisi `peerDeviceId`.
- Klik port dengan peer sekamar → `setPeerDeviceId(peerId)`. `selectedDeviceId` **tidak**
  berubah, jadi `CameraRig` tidak dapat target baru dan kamera diam.
- Gate kartu di `rack-cabinet.tsx:180` diperluas dari `d.id === selectedDeviceId` menjadi
  `d.id === selectedDeviceId || d.id === peerDeviceId`. `selected` (slide-out rail + glow)
  tetap hanya untuk device yang diklik; device peer tidak meluncur keluar.
- `RackScene` meneruskan prop `peerDeviceId` ke `RackCabinet`.
- Port peer diambil dengan `getPortsByDevice(peerDeviceId)` (action yang sudah ada), state
  `peerPorts` / `peerLoading` sejajar dengan `cardPorts` / `cardLoading`.
- Hologram peer memakai komponen `DeviceHologram` yang sama; yang berbeda hanya prop.
  Tombol **Panel** di hologram peer memanggil `setPanelFor(peerDeviceId)` — `selectedDeviceId`
  tidak berubah, jadi kamera tetap diam (lihat §6).
- Anti-loop: hanya hologram utama yang memandu perpindahan. Slot terisi di hologram peer
  hanya memunculkan panel info-nya sendiri (tidak menambah kartu ketiga); slot kosong di
  hologram peer tetap membuka `PortLinkDialog`. Jumlah hologram selalu ≤ 2.
- Menutup hologram utama (`onClose`) juga mereset `peerDeviceId = null`.
- Ganti peer: klik port lain di hologram utama menimpa `peerDeviceId` (kartu peer lama
  hilang, kartu peer baru muncul di posisi stagger hasil hitung ulang).

### 5. Penempatan saat U berdekatan

1U = 0,04445 m. Dua device 1U bersebelahan hanya berjarak beberapa piksel di layar,
sementara kartu ~250 px — jadi tanpa aturan, dua kartu pasti tumpang-tindih.

Aturan (fungsi murni `hologramStagger`, file baru `components/rack3d/hologram-offset.ts`,
supaya bisa diuji tanpa R3F):

```ts
export type HologramAnchor = { locationName: string | null; rackName: string | null; u: number | null };
export function hologramStagger(base: HologramAnchor, peer: HologramAnchor): { base: number; peer: number };
```

- **Rack sama** (`locationName` + `rackName` sama dan `rackName != null`) **dan** selisih U
  `< 4U` → `base` yang U-nya lebih rendah digeser turun `+9rem`, yang lebih tinggi digeser
  naik `-9rem` (U sama → base naik, peer turun; deterministik, tidak pernah bertukar posisi
  saat kamera diorbit).
- Selain itu → `{ base: 0, peer: 0 }`.

Offset diterapkan sebagai `translateY` CSS pada elemen dalam `<Html>`, **bukan** posisi
world-space: hasilnya deterministik dalam piksel dan tidak berubah saat kamera diorbit.

`// ponytail: 9rem cukup untuk kartu ~250px pada U berdekatan; kalau kartu memanjang,
// // ganti dengan pengukuran tinggi kartu.`

### 6. Panel dock: kunci ke device, bukan ke boolean

`panelFor` berubah dari `boolean` menjadi `number | null` (id device), dan
`panelOpen = panelFor !== null`. Panel merender device yang id-nya sama dengan `panelFor`:
`panelDevice = panelFor == null ? null : rackDevices.find((d) => d.id === panelFor) ?? null`,
lalu `{panelDevice && <DeviceDetailPanel device={panelDevice} … />}` — jadi panel bisa
menampilkan device peer tanpa mengubah `selectedDeviceId`.

Ini menghapus guard `if (panelFor !== null && panelFor !== selectedDeviceId) setPanelFor(null)`
yang sekarang ada di `rack-view-3d.tsx:114`, dan membuat tombol Panel dari hologram peer
bekerja: `setPanelFor(peerId)` + menseleksi peer.

Semua yang sudah bergantung pada `panelOpen` (offset topnav, `shift` AppearancePanel, chip
kritis) tetap memakai `panelOpen` — tidak ada perubahan perilaku.

### 7. Kartu 3D rack peer (room lain)

Komponen baru `components/rack3d/peer-rack-card.tsx`.

- **Canvas terpisah** (`<Canvas frameloop="demand">`, sekali render, tanpa composer, tanpa
  Html, tanpa material bersama) supaya tidak menyentuh Canvas utama yang memakai
  `frameloop="demand"` + post-processing + material LED bersama. Kamera tetap dengan
  `lookAt` ke tengah rack; grup rack di-skala `1 / max(rackHeight, 1)` supaya selalu muat.
- Isi: badan rack sederhana (balok) + satu slab per device, posisi Y dari `rackPosition`,
  tinggi dari `uHeight`, warna dari `categoryColor`. Device peer diberi glow/aksen +
  name tag DOM di bawah canvas.
- Header: `Room B · Rack R2 · U12`. Bawah: nama device peer + port tujuan.
- Tombol aksi: **Pindah ke lokasi** → `setRoomPick(peer.locationName)`,
  `setFocusPick(peer.rackName)`, `onSelectDevice(peer)`. Tombol **Tutup** menutup kartu.
- Posisi kartu: `absolute bottom-14 left-3 z-20`, lebar ~260px, di dalam kotak scene 3D
  (view yang sama), tidak menutupi topnav kanan atau panel dock.
- Sumber data: `racks` yang **sudah ada di client** (`getRackLayout()` mengembalikan semua
  rack semua lokasi). Tidak ada fetch server baru untuk kartu ini.
- Device peer tidak ter-rack → kartu tidak dirender, pakai fallback §3 baris ketiga.

### 8. Data flow

| Kebutuhan | Sumber |
|---|---|
| Faceplate hologram | `buildFaceplate()` (`lib/faceplate.ts`), warna `faceplateSlotColors()` |
| Teks hover slot | `describeSlot()` (`components/admin/device-faceplate.tsx`) |
| Port + VLAN + peer + status device | `getPortsByDevice(deviceId)` (sudah ada) |
| Daftar device tujuan dialog link | `deviceOptions` (sudah ada, dari `getDevices()`) |
| Kartu 3D rack peer | `racks` (sudah di client) |
| Riwayat audit + SIEM | `useDeviceDrawer()` (sudah ada) |

Tidak ada perubahan `actions/`, tidak ada migrasi, tidak ada dependency baru.

### 9. Error handling

- Device peer hilang dari `racks` saat kartu terbuka → kartu peer ditutup (state
  `peerDeviceId` di-reset bila device tidak ditemukan).
- `getPortsByDevice(peer)` gagal / kosong → hologram peer menampilkan "No ports documented."
  dan tetap bisa ditutup.
- Device tanpa faceplate → pesan + tombol ke network docs (§1).
- Peer belum ter-rack → fallback route ke network docs peer (§3).
- Kartu 3D rack peer gagal membuat WebGL context → komponen tidak dirender; sisanya
  (hologram, info, link) tetap jalan.

### 10. File

| File | Perubahan |
|---|---|
| `components/rack3d/device-hologram.tsx` | Faceplate SVG menggantikan `<ul>` port; strip hover; panel info slot; prop `device` diperluas dengan field faceplate |
| `components/rack3d/device-hologram.test.tsx` | Disesuaikan: faceplate, hover strip, panel info, dialog link |
| `components/rack3d/hologram-offset.ts` | **Baru** — `hologramStagger` murni |
| `components/rack3d/hologram-offset.test.ts` | **Baru** |
| `components/rack3d/peer-rack-card.tsx` | **Baru** — Canvas mini rack peer |
| `components/rack3d/peer-rack-card.test.tsx` | **Baru** |
| `components/rack3d/rack-view-3d.tsx` | `peerDeviceId`, `peerPorts`, `panelFor` jadi id device, wiring kartu peer + stagger |
| `components/rack3d/rack-cabinet.tsx` | Gate kartu: dua id, bukan satu |
| `components/rack3d/rack-scene.tsx` | Teruskan `peerDeviceId` |

### 11. Testing

- `hologram-offset.test.ts`: rack sama + 1U → `±9rem`; rack sama + 10U → `0/0`; rack beda →
  `0/0`; `rackName` null → `0/0`; U sama → base naik, peer turun.
- `device-hologram.test.tsx`: faceplate merender rect sejumlah `portCount + uplinkCount`;
  hover slot terisi → strip memuat VLAN dan nama device peer; klik slot terisi → panel info
  memuat `[Edit link]`; klik slot kosong → `PortLinkDialog`; device tanpa faceplate → pesan
  + link network docs.
- `peer-rack-card.test.tsx`: header memuat nama room/rack/U device peer; klik **Pindah ke
  lokasi** memanggil `onMove`.
- Gate: `npm run test`, `npm run lint`, `npm run typecheck` hijau pada file yang diubah dan
  seluruh suite.

### Non-goals

- Tidak mengubah DB, `actions/network.ts`, atau `updatePort` (sudah selesai di spec sebelumnya).
- Tidak mengubah faceplate 2D / export PDF (hanya memakai `buildFaceplate` + `describeSlot`).
- Tidak menambah dependency.
- Tidak mengubah cara kabel digambar atau cara kamera fly-to bekerja untuk kasus lain.
- Tidak membuat hologram untuk lebih dari dua device sekaligus.
