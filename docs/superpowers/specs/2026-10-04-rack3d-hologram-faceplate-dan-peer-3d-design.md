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
  informasi, dan dari situ `[Edit link]` menautkan port — plus **langsung menampilkan peer**
  di view yang sama. Slot kosong hanya tampil, tanpa aksi (provisioning di network docs).
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

- Hologram merender `<svg viewBox={`0 0 ${plate.width} ${plate.height}`}>` dengan satu `<g>`
  per slot dari `plate.slots`, **memakai ulang resep render faceplate 2D**
  (`components/admin/device-faceplate.tsx:207-296`) supaya hasilnya identik:
  - `<title>{describeSlot(slot)}</title>`
  - `<rect rx={1.5}>` fill `faceplateSlotColors(slot.port).fill`, stroke `colors.stroke`
    (jadi `#f8fafc` + `strokeWidth` 1.4 saat hover), `strokeDasharray`
    `slot.port ? undefined : "2 1.5"` (slot kosong putus-putus)
  - slot uplink: bar horizontal (`x+3`, `y+h/2-1.5`, `w-6`, tinggi 3, rx 0.6, `#000` opacity .35);
    slot tembaga: notch (`x+w/2-3`, `y+h-4.5`, 6, 3, rx 0.5, `#000` opacity .3)
  - `colors.accent` → bar kiri (`x`, `y`, lebar 2, tinggi `h`, rx 1) untuk mode Trunk/Routed/LACP
  - **indikator terhubung** yang sudah dipakai 2D: `<circle cx={x+w-2.6} cy={y+2.6} r={1.3} fill="#f8fafc" opacity={0.85} />`
    saat `slot.port?.connectedToPortId` — inilah yang membuat port terhubung terlihat tanpa hover
  - nomor slot `<text>` tengah, `fontSize 7`, monospace, `fontWeight 600`, fill `colors.label`,
    `pointerEvents="none"`
  - label blok dari `plate.blocks` (`fontSize 6`, `#94a3b8`, monospace) + chassis `rect` rx 3
- Resep ini **disalin**, bukan diekstrak jadi komponen bersama: faceplate 2D terikat pada
  modalnya sendiri (`edit-port-modal`, `quick-add-port-modal`, `updatePortSlot`,
  `router.refresh`) sehingga mengekstrak SVG-nya berarti menyentuh halaman 2D — di luar
  lingkup (lihat Non-goals).
- Slot kosong tetap dirender (abu, dengan nomor slot, kotak putus-putus seperti faceplate 2D)
  supaya bentuk faceplate utuh dan slot kosong bukan area buta di kartu. Slot kosong tidak
  punya aksi (lihat §2).
- **Hologram tidak membuat port baru.** Provisioning port (`QuickAddPortModal` → `addPort`,
  butuh `getVlans()`) tetap di network docs; hologram hanya bisa *menghubungkan* port yang
  sudah ada (`PortLinkDialog` → `updatePort`, pilih dari `getPortsByDevice` device tujuan).
  Tombol **Full Docs** adalah jalur keluar untuk provisioning (dan itu satu-satunya).
  Konsekuensi: device yang belum punya port sama sekali tidak bisa diapa-apakan dari
  hologram selain dibuka Full Docs-nya.
- Device tanpa faceplate dikonfigurasi (`isFaceplateConfigured` false) → hologram jatuh ke
  pesan ringkas "Faceplate not configured" + tombol ke network docs. Tidak ada grid generik
  (network docs adalah satu-satunya sumber kebenaran port).
- **Bahasa:** teks baru di hologram memakai bahasa Inggris, mengikuti copy hologram yang
  sudah ada ("Not linked", "Loading ports…", "Panel", "Full Docs", "Faceplate not
  configured", "empty"). Pengecualian yang disengaja: strip hover dan `aria-label` untuk slot
  **terisi** memakai `describeSlot()` apa adanya, jadi tetap berbahasa Indonesia (teksnya
  dibagi dengan faceplate 2D — lihat §2).
- **Tidak ada perubahan action.** `getPortsByDevice` **sudah** memilih `trunkVlans`
  (`actions/network.ts:123`), jadi `FloatPort` sudah punya semua field yang dibutuhkan
  `describeSlot` dan **bentuknya sudah identik dengan `NetworkPortRow`** (tipe parameter
  `describeSlot`) — tidak perlu cast, tidak perlu ubah `select`. (Catatan: `RackDevicePort`
  dari `getRackLayout` memang tidak punya `trunkVlans`, tapi hologram memakai port dari
  `getPortsByDevice`, bukan dari `device.ports`.)
- Lebar kartu `w-72` → `w-80` supaya slot 48 port masih nyaman di-hover.
- Port yang tidak bisa dipetakan ke slot (`plate.unplaced`) ditampilkan sebagai baris kecil
  di bawah faceplate dengan jumlahnya, bukan dijatuhkan diam-diam.
- Prop `device` di `DeviceHologram` diperluas dari
  `Pick<RackDevice, "id" | "name" | "ipAddress" | "status" | "openIncidents">` menjadi
  `Pick<RackDevice, "id" | "name" | "ipAddress" | "status" | "openIncidents" | "faceplatePortCount" | "faceplateUplinkCount" | "faceplateRows" | "faceplateNumbering" | "rackPosition" | "rackName" | "locationName">`.
  `faceplate*` membentuk config `buildFaceplate`; `rackPosition` dipakai `hologramStagger`;
  `rackName` + `locationName` dipakai untuk memutuskan peer sekamar.

### 2. Hover + klik slot

- **Hover slot** → strip satu baris di bawah faceplate. Untuk slot **terisi** memakai
  `describeSlot(slot)` dari `components/admin/device-faceplate.tsx` (fungsi yang sama dengan
  faceplate 2D, sehingga teksnya konsisten dan tidak ada duplikasi format). `describeSlot`
  diimpor apa adanya; tidak dipindah ke `lib/` di pekerjaan ini.
- **Pengecualian slot kosong.** `describeSlot` mengakhiri cabang kosongnya dengan
  "... klik untuk provisioning port" (`device-faceplate.tsx:50`) — kalimat yang benar di
  faceplate 2D tapi **salah di hologram**, karena slot kosong di sini tidak punya aksi (§2).
  Jadi strip untuk slot kosong memakai teks sendiri: `Slot N — empty` (atau
  `Uplink slot N — empty`), dibangkitkan di hologram. `aria-label` slot kosong memakai teks
  yang sama, bukan `describeSlot`, supaya pembaca layar tidak menjanjikan aksi yang tidak ada.
  Slot terisi tetap memakai `describeSlot` apa adanya (termasuk bahasanya yang Indonesia).
- **Klik slot terisi** → dua hal terjadi bersamaan:
  1. Panel informasi kecil muncul di dalam hologram: nama port, mode, VLAN/trunk, speed,
     media, deskripsi, dan peer (`→ Nama :Port`) + dua tombol: `[Edit link]` (membuka
     `PortLinkDialog` **untuk port slot itu** — inilah satu-satunya pintu link di hologram)
     dan `[Tutup]`.
  2. Aksi peer dijalankan sesuai §3 (hologram kedua bila sekamar, kartu 3D rack peer bila
     beda lokasi), tetapi **hanya kalau port itu sudah punya peer** (`connectedToDeviceId != null`).
- **Klik slot kosong → tidak ada aksi.** Slot kosong tidak punya port, jadi
  `PortLinkDialog` (yang butuh `port: FloatPort` sebagai sisi sumber) tidak bisa dipakai, dan
  membuat port baru (`addPort` + `getVlans`) sudah diputuskan di luar hologram (§1). Hologram
  hanya menampilkan slotnya (dan status kosongnya), tidak menawarkan provisioning.
- **Menghubungkan port yang belum ter-link**: klik slot terisi → panel info → `[Edit link]` →
  `PortLinkDialog`. Ini yang menjalankan keputusan yang sudah disetujui: **info dulu, edit
  lewat tombol**.
- **Info yang tetap terlihat tanpa hover** (penting karena sentuhan/touch tidak punya hover):
  port yang sudah terhubung selalu diberi **indikator terhubung** pada slot-nya (lingkaran
  `#f8fafc` di kanan-atas — sama dengan faceplate 2D baris 278-280), jadi peer tidak hanya
  bisa ditemukan lewat hover. Nomor slot juga selalu tercetak di slot.
- Slot **terisi** bisa difokus keyboard (`tabIndex`, `role="button"`,
  `aria-label={describeSlot(slot)}`, `onKeyDown` untuk Enter/Space) — meniru faceplate 2D
  (`components/admin/device-faceplate.tsx:215-225`). Slot **kosong** tidak diberi
  `role`/`tabIndex`/`onKeyDown`, karena tidak ada aksi yang bisa dijalankan — menandainya
  sebagai tombol akan membuat Tab berhenti di elemen mati. Keduanya tetap punya `<title>`.

`DeviceHologram` menjadi pemilik state panel info (satu `selectedSlot`), dan prop baru
`onPickPort?: (port: FloatPort) => void` menjadi **opsional**: kalau tidak diberikan,
klik slot terisi hanya membuka panel info tanpa memandu perpindahan. Hologram utama
memberikan `onPickPort`; hologram peer tidak (anti-loop §4).

**Seam test (lingkungan node, tanpa jsdom).** Repo menjalankan Vitest di `environment:
"node"` tanpa jsdom dan tanpa `@testing-library` (`vitest.config.ts`), jadi klik/hover tidak
bisa disimulasikan. Mengikuti pola yang sudah dipakai repo (`components/checklist/field-audit-card.test.ts`
mengekstrak handler murni; `components/ui/theme-toggle.test.tsx` mem-mock `globalThis.document`),
`DeviceHologram` menerima dua prop opsional yang dikendalikan pemanggil untuk pratinjau
keadaan:

```ts
/** Test seam: render as if this slot were hovered / selected. Ignored once the user interacts. */
hoveredSlotKey?: string | null;
selectedSlotKey?: string | null;
```

Keduanya default `undefined` (state internal yang dipakai). Ini yang membuat strip hover dan
panel info bisa diuji lewat `renderToStaticMarkup` tanpa menambah dependency atau jsdom.

### 3. Aksi peer saat slot terisi diklik

Bergantung lokasi peer:

| Peer | Yang terjadi |
|---|---|
| Room sama | Hologram kedua muncul untuk device peer. **Kamera tidak bergerak.** |
| Room lain | `PeerRackCard` (kartu 3D rack peer) muncul di dalam view yang sama. Kamera tidak bergerak sampai kartu diklik. |
| Tidak ter-rack (`racks` tidak memuat device itu) | Fallback lama: `router.push('/admin/devices/{id}/network')`. |

Predikat room: sebuah rack termasuk room yang sedang tampil bila
`(rack.locationName || UNASSIGNED) === room`, dengan `room` dan `UNASSIGNED` persis seperti
yang sudah dipakai `RackView3D` hari ini (`rack-view-3d.tsx:117`, `:363`). Keputusan room
sama / room lain / belum ter-rack diambil di `RackView3D`, karena di situlah `racks`
(semua rack semua lokasi) tersedia.

### 4. Dua hologram, room sama

- State baru di `RackView3D`:
  - `peerDeviceId: number | null` — device peer yang sedang ditampilkan.
  - `peerPickedRoom: string | null` — room saat peer itu dipilih.

  Turunannya:
  ```ts
  const allDevices = racks.flatMap((r) => r.devices);
  const peerDevice = peerDeviceId == null ? null : allDevices.find((d) => d.id === peerDeviceId) ?? null;
  const peerRack = peerDevice == null ? null : racks.find((r) => r.devices.some((d) => d.id === peerDevice.id)) ?? null;
  const peerRoomKey = peerRack == null ? null : (peerRack.locationName || UNASSIGNED);
  const peerInRoom = peerRack != null && peerRoomKey === room;
  const peerCardRack = peerRack != null && !peerInRoom ? peerRack : null;
  ```
  Tiga hasil: `peerInRoom` → hologram kedua; `peerCardRack` → `PeerRackCard` (§7);
  `peerDevice == null` → tidak ada yang ditampilkan (peer tidak ter-rack, sudah di-route ke
  network docs). `peerDeviceId` **diisi untuk peer room lain juga**, karena `PeerRackCard`
  butuh device + rack-nya.
- Klik port dengan peer → `setPeerDeviceId(peer.id); setPeerPickedRoom(room);`
  `selectedDeviceId` **tidak** berubah, jadi `CameraRig` tidak dapat target baru dan kamera diam.
- Reset saat room berubah: `if (peerDeviceId !== null && peerPickedRoom !== room) setPeerDeviceId(null);`
  — kartu peer beda-lokasi hidup selama room tidak berubah. Tanpa `peerPickedRoom`, aturan
  reset berbasis "peer bukan di room ini" akan langsung menghapus kartu beda-lokasi, jadi dua
  state ini memang perlu dipisah.
- Gate kartu di `rack-cabinet.tsx:180` diperluas dari `d.id === selectedDeviceId` menjadi
  `d.id === selectedDeviceId || d.id === peerDeviceId`. `RackView3D` sudah menyaring peer
  room lain lebih dulu (`peerDeviceId={peerInRoom ? peerDeviceId : null}`), jadi `RackCabinet`
  cukup menerima satu prop dan tidak perlu tahu soal room. `selected` (slide-out rail + glow)
  tetap hanya untuk device yang diklik; device peer tidak meluncur keluar.
- **Reset saat pilihan utama hilang.** `peerDeviceId` tidak boleh hidup tanpa hologram utama,
  karena stagger butuh device dasar. Tiga jalur menghapus pilihan dan **tidak** lewat
  `onClose`: tombol Escape (`rack-view-3d.tsx:192`), `onPointerMissed` di dalam scene
  (`rack-scene.tsx:266`), dan `pickRoom`/`backToRoom`. Jadi reset tidak boleh digantungkan
  pada `onClose`; pakai guard render-time di `RackView3D`:
  `if (selectedDeviceId === null && peerDeviceId !== null) setPeerDeviceId(null);`
  (pola yang sama dengan guard room, lolos `react-hooks/set-state-in-effect`).
- **Peer tidak boleh device yang sama.** Kalau data lama menyimpan link ke diri sendiri,
  `peerDeviceId === selectedDeviceId` akan menumpuk dua hologram di satu device. Jangan
  setel peer kalau `peer.id === selectedDeviceId`.
- **Penting:** `RackScene` tidak merender rack di luar baris yang difokus (atau di luar
  `peerRacks`) — lihat `rack-scene.tsx:274`. `buildCables(placed, selectedDeviceId)` hanya
  menghitung peer dari link device terpilih, jadi rack peer sekamar bisa ter-skip ketika ada
  rack yang difokus dan peer berada di rack lain. Perbaikan: `buildCables` menerima daftar
  id yang dicari, bukan satu id — `buildCables(placed, [selectedDeviceId, peerDeviceId])` —
  sehingga baris rack yang memuat device peer ikut dirender.
- `RackScene` menerima prop baru `peerDeviceId?: number | null` dan meneruskannya ke
  `RackCabinet`, serta memakainya untuk pencarian `buildCables` (di bawah).
- Port peer diambil dengan `getPortsByDevice(peerDeviceId)` (action yang sudah ada), state
  `peerPorts` / `peerLoading` sejajar dengan `cardPorts` / `cardLoading`.
- Hologram peer memakai komponen `DeviceHologram` yang sama; yang berbeda hanya prop
  (`onPickPort` tidak diberikan ⇒ anti-loop; `offsetY` dari stagger).
  Tombol **Panel** di hologram peer memanggil `setPanelFor(peerDeviceId)` — `selectedDeviceId`
  tidak berubah, jadi kamera tetap diam (lihat §6).
- Anti-loop: hanya hologram utama yang memandu perpindahan. Slot terisi di hologram peer
  hanya memunculkan panel info-nya sendiri (tidak menambah kartu ketiga); `[Edit link]` di
  hologram peer tetap bisa membuka `PortLinkDialog` untuk port itu. Jumlah hologram selalu ≤ 2.
- `onLinked` dari hologram peer (link baru disimpan) **tidak** memindahkan kamera: kalau
  device tujuan ada di room ini dan bukan `selectedDeviceId`, `peerDeviceId` diganti ke
  device itu; kalau tidak ada di room ini, tidak ada kartu baru (`PeerRackCard` hanya
  dipicu dari hologram utama).
- Menutup hologram utama (`onClose`) juga mereset `peerDeviceId = null`.
- Menutup hologram peer (`onClose`) hanya mereset `peerDeviceId = null`; `selectedDeviceId`
  tidak berubah.
- Ganti peer: klik port lain di hologram utama menimpa `peerDeviceId` (kartu peer lama
  hilang, kartu peer baru muncul di posisi stagger hasil hitung ulang).
- Kalau port yang diklik menunjuk peer yang **sama** dengan `peerDeviceId` sekarang, state
  tidak berubah (tidak ada kedip kartu).

### 5. Penempatan saat U berdekatan

1U = 0,04445 m. Dua device 1U bersebelahan hanya berjarak beberapa piksel di layar,
sementara kartu `w-80` tingginya ~260 px — jadi tanpa aturan, dua kartu pasti tumpang-tindih.

Aturan (fungsi murni `hologramStagger`, file baru `components/rack3d/hologram-offset.ts`,
supaya bisa diuji tanpa R3F):

```ts
export type HologramAnchor = { locationName: string | null; rackName: string | null; u: number | null };
export function hologramStagger(base: HologramAnchor, peer: HologramAnchor): { base: number; peer: number };
```

Nilai yang dikembalikan adalah jumlah rem untuk `translateY` (`base` ke `DeviceHologram`
utama, `peer` ke hologram peer). `DeviceHologram` menerima prop baru
`offsetY?: number` (default `0`) dan menerapkannya pada elemen terluarnya; `RackView3D`
menghitung `hologramStagger(...)` sekali dengan `useMemo` dari device terpilih + device peer.

- **Gerbang pertama:** lokasi dan rack harus sama. Jika
  `base.locationName !== peer.locationName` **atau** `base.rackName !== peer.rackName`
  **atau** `base.rackName == null` **atau** `peer.rackName == null` → `{ base: 0, peer: 0 }`.
  Dua kartu yang tidak mungkin berdekatan di layar tidak perlu digeser.
- Hanya kalau gerbang itu lolos, urutan aturan berikut menentukan hasil (jangan dibalik):

  1. `base.u == null` dan `peer.u == null` → `{ base: -9, peer: +9 }`.
  2. Hanya `base.u == null` → `{ base: -9, peer: +9 }` (yang tanpa U dianggap lebih tinggi).
  3. Hanya `peer.u == null` → `{ base: +9, peer: -9 }` (kebalikannya).
  4. Keduanya ada angka dan `|base.u - peer.u| >= 4` → `{ base: 0, peer: 0 }`.
  5. Keduanya ada angka dan `|base.u - peer.u| < 4`:
     - `base.u < peer.u` → `{ base: +9, peer: -9 }`
     - `base.u > peer.u` → `{ base: -9, peer: +9 }`
     - `base.u === peer.u` → `{ base: -9, peer: +9 }` (kasus U sama masuk ke cabang ini; tidak
       ada aturan "U sama" terpisah)

Catatan implementasi: aturan 1-3 hanya relevan setelah gerbang lokasi/rack lolos, jadi cabang
`u == null` tidak perlu diulang di dalamnya. `base` = hologram device yang diklik, `peer` =
hologram device ujung.

Slot U yang dipakai adalah `device.rackPosition` (1-based, sama dengan `uToY(device.rackPosition ?? 1)`
di `rack-device.tsx:252`); `0` dan nilai negatif diperlakukan sebagai tidak diketahui
(`null`), karena rack mulai dari U1.

Offset diterapkan sebagai `translateY` CSS pada elemen dalam `<Html>`, **bukan** posisi
world-space: hasilnya deterministik dalam piksel dan tidak berubah saat kamera diorbit.

```ts
// ponytail: 9rem cukup untuk kartu setinggi ~260px pada U berdekatan; kalau kartu
// memanjang, ganti dengan pengukuran tinggi kartu.
```

### 6. Panel dock: kunci ke device, bukan ke boolean

`panelFor` berubah dari `boolean` menjadi `number | null` (id device), dan
`panelOpen = panelFor !== null`. Panel merender device yang id-nya sama dengan `panelFor`:
`panelDevice = panelFor == null ? null : allDevices.find((d) => d.id === panelFor) ?? null`
(`allDevices` = `racks.flatMap((r) => r.devices)`, sumber yang sama dengan `cardDevice` di
`rack-view-3d.tsx:120`), lalu `{panelDevice && <DeviceDetailPanel device={panelDevice} … />}`
— jadi panel bisa menampilkan device peer tanpa mengubah `selectedDeviceId`.

Ini menghapus guard `if (panelFor !== null && panelFor !== selectedDeviceId) setPanelFor(null)`
yang sekarang ada di `rack-view-3d.tsx:114`, dan membuat tombol Panel dari hologram peer
bekerja: `setPanelFor(peerDeviceId)` — `selectedDeviceId` sengaja **tidak** diubah supaya
kamera tetap di tempat. `panelDevice` dicari dari daftar device semua rack (`racks`
di-flatten), bukan hanya rack yang difokus.

Guard lama punya satu tugas yang masih dibutuhkan: memilih device **lain** harus menutup
panel device sebelumnya, supaya panel mengikuti pilihan terbaru. Karena `panelFor` sekarang
boleh berbeda dari `selectedDeviceId` (itulah cara panel peer bekerja), guard tidak bisa lagi
membandingkan keduanya. Gantinya, ingat device yang terakhir dipilih:

```ts
const [panelFor, setPanelFor] = useState<number | null>(null);
const [appliedPanelSel, setAppliedPanelSel] = useState<number | null>(null);
if (selectedDeviceId !== appliedPanelSel) {
    setAppliedPanelSel(selectedDeviceId);
    if (panelFor !== null && panelFor !== selectedDeviceId) setPanelFor(null);
}
const setPanelOpenState = (open: boolean) => setPanelFor(open ? selectedDeviceId : null);
const panelOpen = panelFor !== null;
```

Pola "ingat nilai sebelumnya" ini sama dengan `appliedSelected` / `appliedAuto` yang sudah
ada di `rack-view-3d.tsx:91-110`.

Semua yang sudah bergantung pada `panelOpen` (offset topnav, `shift` AppearancePanel, chip
kritis) tetap memakai `panelOpen` — tidak ada perubahan perilaku.

### 7. Kartu 3D rack peer (room lain)

Dua file baru, dipisah supaya bisa diuji:

- `components/rack3d/peer-rack-mini.tsx` — **hanya** bagian R3F (Canvas + bentuk rack +
  slab). Tidak pernah diimpor test.
- `components/rack3d/peer-rack-card.tsx` — kerangka DOM (header, label, tombol) yang
  mengimpor mini lewat `next/dynamic` dengan `ssr: false`, persis pola yang sudah dipakai
  `rack-view-3d.tsx:21` untuk `RackScene`. Test mem-mock `next/dynamic`, jadi R3F tidak
  pernah dimuat di lingkungan `node` (repo tanpa jsdom — §2).

Isi `peer-rack-mini.tsx`:

- **Canvas terpisah** (`<Canvas frameloop="demand">`, sekali render, tanpa composer, tanpa
  Html, tanpa material bersama) supaya tidak menyentuh Canvas utama yang memakai
  `frameloop="demand"` + post-processing + material LED bersama. Kamera tetap dengan
  `lookAt` ke tengah rack; grup rack di-skala `1 / max(rackHeight(totalU), 1)` supaya selalu
  muat.
- Isi: badan rack sederhana (balok) + satu slab per device, posisi Y dari `rackPosition`,
  tinggi dari `uHeight`, warna dari `categoryColor`. Device peer diberi glow/aksen.
- Props mini: `{ devices: RackDevice[]; totalU: number; peerId: number }`.

Isi `peer-rack-card.tsx`:

- Header: `Room B · Rack R2 · U12`. Bawah: nama device peer + port tujuan.
- Props: `{ rack: SceneRack; peer: RackDevice; portName: string | null; onMove: () => void; onClose: () => void }`.
  `rack` dibutuhkan untuk `totalU` + daftar device (slab), `peer` untuk posisi U + nama,
  `portName` untuk label port tujuan. Tidak ada fetch di dalam komponen.
- Tombol aksi **Pindah ke lokasi** memanggil `onMove`; `RackView3D` yang menjalankan
  `setRoomPick(peer.locationName || UNASSIGNED)`, `setFocusPick(peer.rackName)`,
  `onSelectDevice(peer)` — pola yang sama dengan `onPickPort` yang sudah ada
  (`rack-view-3d.tsx:363`). Tombol **Tutup** memanggil `onClose` (`peerDeviceId = null`).
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
| Port + VLAN + peer + status device | `getPortsByDevice(deviceId)` (sudah ada dan sudah memilih `trunkVlans`; tidak diubah) |
| Daftar device tujuan dialog link | `deviceOptions` (sudah ada, dari `getDevices()`) |
| Kartu 3D rack peer | `racks` (sudah di client) |
| Riwayat audit + SIEM | `useDeviceDrawer()` (sudah ada) |

Tidak ada migrasi, tidak ada dependency baru, tidak ada perubahan action sama sekali —
`actions/network.ts` tidak disentuh.

### 9. Error handling

- Device peer hilang dari `racks` saat kartu terbuka → device peer tidak ditemukan →
  `peerDeviceId` di-reset, `PeerRackCard` tidak dirender.
- Device peer **tetap ada** tetapi ter-mute oleh filter (`device.isMuted`, opacity 0,12) →
  belum ditangani; hologram peer tetap muncul. Catat sebagai batasan yang diketahui, bukan
  bug yang diperbaiki di pekerjaan ini.
- `getPortsByDevice(peer)` gagal / kosong → sama seperti device biasa: faceplate tetap
  dirender dengan semua slot kosong (tidak ada pesan khusus), dan hologram tetap bisa ditutup.
- Device dengan faceplate terkonfigurasi tetapi **belum punya satu port pun** → faceplate
  kosong dirender (semua slot putus-putus), footer `0/0 Linked`. **Tidak** ada pesan
  "No ports documented" — §1 menetapkan slot kosong selalu dirender, jadi kabar "belum ada
  port" disampaikan oleh faceplate kosong itu sendiri, bukan oleh pesan yang menggantikannya.
- Device tanpa faceplate → pesan + tombol ke network docs (§1).
- Peer belum ter-rack → fallback route ke network docs peer (§3).
- Ganti room (`roomPick` berubah) → `peerDeviceId` di-reset, karena kartu/hologram peer hanya
  masuk akal di room yang sedang tampil (§4). Reset ditulis sebagai guard render-time
  mengikuti pola yang sudah dipakai repo di `rack-view-3d.tsx:114`
  (`if (peerDeviceId !== null && peerPickedRoom !== room) setPeerDeviceId(null);`), bukan
  `useEffect` — pola ini yang lolos aturan lint `react-hooks/set-state-in-effect` di repo ini.
- Kartu 3D rack peer gagal membuat WebGL context → komponen tidak dirender; sisanya
  (hologram, info, link) tetap jalan. Tombol **Pindah ke lokasi** tetap tersedia karena
  header/tombol adalah DOM di luar Canvas.

### 10. File

| File | Perubahan |
|---|---|
| `actions/network.ts` | **Tidak berubah** — `trunkVlans` sudah ada di `select` `getPortsByDevice` |
| `components/rack3d/device-hologram.tsx` | Faceplate SVG menggantikan `<ul>` port; strip hover; panel info slot; `onPickPort` opsional; seam `hoveredSlotKey`/`selectedSlotKey`; `offsetY`; prop `device` diperluas dengan field faceplate |
| `components/rack3d/device-hologram.test.tsx` | Disesuaikan: faceplate, hover strip, panel info, dialog link, `offsetY`, tanpa faceplate |
| `components/rack3d/hologram-offset.ts` | **Baru** — `hologramStagger` murni |
| `components/rack3d/hologram-offset.test.ts` | **Baru** |
| `components/rack3d/cable-route.ts` | `buildCables` menerima daftar id, bukan satu id |
| `components/rack3d/cable-route.test.ts` | Disesuaikan dengan signature baru + kasus dua id |
| `components/rack3d/peer-rack-mini.tsx` | **Baru** — Canvas mini rack peer (R3F saja, tidak diimpor test) |
| `components/rack3d/peer-rack-card.tsx` | **Baru** — kerangka DOM kartu peer; mengimpor mini lewat `next/dynamic` |
| `components/rack3d/peer-rack-card.test.tsx` | **Baru** — mock `next/dynamic`, uji markup |
| `components/rack3d/rack-view-3d.tsx` | `peerDeviceId`, `peerPorts`, `panelFor` jadi id device, wiring kartu peer + stagger |
| `components/rack3d/rack-cabinet.tsx` | Gate kartu: dua id, bukan satu |
| `components/rack3d/rack-scene.tsx` | Teruskan `peerDeviceId`, panggil `buildCables` dengan dua id |

### 11. Testing

- `hologram-offset.test.ts`: rack sama + 1U → base `+9`, peer `-9`; rack sama + 10U → `0/0`;
  rack beda → `0/0`; `locationName` beda → `0/0`; `rackName` null (salah satu) → `0/0`;
  `base.u > peer.u` → `base -9, peer +9`; `u` sama → `{ base: -9, peer: +9 }`;
  `base.u === null` dan `peer.u === null` (rack sama) → `{ -9, +9 }`; hanya `peer.u === null`
  (rack sama) → `{ +9, -9 }`; hanya `base.u === null` → `{ -9, +9 }`; `u: 0` → diperlakukan
  `null` (rack sama, peer punya U) → `{ -9, +9 }`, bukan crash.
- `cable-route.test.ts`: `buildCables(placed, [sel, peer])` memasukkan rack peer ke
  `peerRacks` dan menggambar kabel untuk kedua device; `buildCables(placed, [sel, null])`
  tidak berubah dari perilaku sekarang.
- `device-hologram.test.tsx`: faceplate merender satu slot per `portCount + uplinkCount`;
  `hoveredSlotKey` pada slot terisi → strip memuat VLAN dan nama device peer;
  `hoveredSlotKey` pada slot kosong → strip **tidak** memuat "provisioning" (teks
  "empty", §2); `selectedSlotKey` pada slot terisi → panel info memuat `Edit link`;
  `selectedSlotKey` pada slot kosong → tidak ada panel info; slot terisi tanpa peer → panel
  info memuat `Edit link` tetapi tidak memicu aksi peer; device tanpa faceplate →
  "Faceplate not configured" + link network docs; `offsetY` diterapkan sebagai `translateY`
  pada elemen terluar; `ports={[]}` pada device **berfaceplate** → faceplate tetap dirender,
  footer `0/0 Linked`, dan **tidak** ada pesan "No ports documented" (§9).
- Test `onPickPort` opsional: karena pemanggilan klik tidak bisa disimulasikan di lingkungan
  node, bagian ini **tidak** diuji lewat event. Yang diuji adalah aksi peer tetap tersedia
  lewat tombol `Edit link` (yang memang memanggil `onPickPort`), dan difokuskan pada
  pemanggilan handler secara langsung seperti pola `handleChecklistPhotoFile`.
- `peer-rack-card.test.tsx`: header memuat nama room/rack/U device peer; tombol tersedia
  lewat markup (klik tidak disimulasikan — handler `onMove` diuji dengan memanggil prop
  secara langsung atau lewat seam yang sama).
- Gate: `npm run test`, `npm run lint`, `npm run typecheck` hijau pada file yang diubah dan
  seluruh suite (jalankan vitest dengan `--exclude "**/.kilo/**"`).

### Non-goals

- Tidak mengubah DB atau semantik `updatePort` (sudah selesai di spec sebelumnya).
- Tidak mengubah faceplate 2D / export PDF (hanya memakai `buildFaceplate` + `describeSlot`);
  `describeSlot` tidak dipindah ke `lib/`, dan resep SVG 2D disalin ke hologram bukan
  diekstrak jadi komponen bersama.
- Tidak menambah dependency.
- Tidak mengubah cara kabel digambar (hanya daftar id yang dicari) atau cara kamera fly-to
  bekerja untuk kasus lain.
- Tidak membuat hologram untuk lebih dari dua device sekaligus.
- Tidak menangani device peer yang ter-mute filter (§9).
- Tidak menambah provisioning port di hologram (tetap di network docs) dan tidak menyentuh
  `QuickAddPortModal`/`addPort`/`getVlans` (§1).
- Tidak menambah jsdom / `@testing-library` — seam prop (§2) sudah cukup.
