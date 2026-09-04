# Design Specification: Threat Intelligence Case Reader Modal (ISO 27001)

## Overview
Menyediakan antarmuka pop-up pembaca kasus (Case Reader Modal) untuk rekaman Threat Intelligence & Kerentanan Teknis (ISO 27001 Control A.5.7 & A.8.8) di DC-Check. Pengguna dapat membuka detail kasus dengan mengklik judul threat pada tabel ataupun tombol aksi "Lihat Detail" (icon mata).

---

## User Flow & Triggers
1. **Trigger A (Judul Threat)**: Pada tabel `ThreatIntelTable`, teks judul (`item.title`) diformat sebagai tautan/tombol interaktif (`cursor-pointer`, hover styling). Klik membuka detail modal untuk item tersebut.
2. **Trigger B (Aksi View)**: Pada kolom "Aksi" di tabel, ditambahkan icon button "Lihat Detail" (`Eye` icon) bersanding dengan icon "Edit" (`Edit2`) dan "Hapus" (`Trash2`).
3. **Modal Interactions**:
   - Modal tampil di tengah layar (`max-w-4xl`), mendukung tombol ESC, klik backdrop, dan tombol close [X].
   - Jika pengguna ingin memperbesar foto bukti, klik thumbnail akan memanggil `PhotoModal` (z-index terkoordinasi).
   - Tombol "Edit Advisory" di footer modal langsung membuka `ThreatIntelFormModal` untuk mengedit rekaman aktif.

---

## Component Architecture

### 1. `ThreatIntelDetailModal` (`components/compliance/threat-intel-detail-modal.tsx`) [NEW]
* **Props**:
  * `item: ThreatIntelRecord | null`
  * `open: boolean`
  * `onClose: () => void`
  * `onEdit: (item: ThreatIntelRecord) => void`
  * `onViewPhoto: (photoPath: string, caption?: string) => void`
* **Sections**:
  1. **Header**:
     - Judul advisory lengkap & jelas
     - Tanggal rilis informasi
     - Badges: CVSS score + Severity tone (Critical, High, Medium, Low, Info), Status (Open, In Progress, Resolved, N/A)
  2. **Metadata & Source Strip**:
     - Nama sumber (The Hacker News, CISA, dll.) + link eksternal (jika ada `sourceUrl`)
     - Tag CVE (`cveList`) yang dapat diklik ke basis data NVD NIST (`https://nvd.nist.gov/vuln/detail/<CVE>`)
     - Asset terdampak, Site Data Center, dan Perangkat terikat (`deviceName`)
  3. **Deskripsi Teknis (Technical Advisory)**:
     - Teks deskripsi lengkap (`item.description`) dengan font readable (`leading-relaxed text-sm`), kontras tajam dalam dark/light mode
  4. **Mitigasi & Rencana Tindakan (ISO 27001 A.8.8 Control)**:
     - Card visual khusus (`border-emerald-500/30 bg-emerald-500/5`)
     - Tanggal mitigasi (`actionDate`)
     - Rencana aksi patching / solusi (`actionPlan` atau fallback "Belum ada rencana mitigasi tertulis")
  5. **Galeri Bukti Dukung (Evidence Gallery)**:
     - Grid thumbnail foto bukti dari `item.evidence`
     - Keterangan caption & tombol zoom untuk melihat resolusi penuh
  6. **Footer**:
     - Tombol "Edit Advisory" (membuka form edit langsung)
     - Tombol "Tutup" (`ActionButton variant="secondary"`)

### 2. `ThreatIntelTable` (`components/compliance/threat-intel-table.tsx`) [MODIFY]
* Tambah prop `onViewDetail: (item: ThreatIntelRecord) => void`.
* Judul threat dibungkus dengan button trigger `onClick={() => onViewDetail(item)}`.
* Kolom aksi ditambah button `Eye` dengan tooltip "Lihat Detail".

### 3. `ThreatIntelClient` (`components/compliance/threat-intel-client.tsx`) [MODIFY]
* State `viewingItem: ThreatIntelRecord | null`.
* Handler `handleViewDetail = (item: ThreatIntelRecord) => setViewingItem(item)`.
* Render `<ThreatIntelDetailModal open={Boolean(viewingItem)} item={viewingItem} onClose={() => setViewingItem(null)} onEdit={(item) => { setViewingItem(null); setEditingItem(item); }} onViewPhoto={handleViewPhoto} />`.

---

## Testing & Quality Gate
* Unit test baru untuk `ThreatIntelDetailModal` di `components/compliance/threat-intel-detail-modal.test.tsx`:
  * Render modal dengan data terisi lengkap.
  * Memastikan tombol NVD link, badge severity, CVE tags, tindakan mitigasi, dan bukti ter-render.
  * Callback `onEdit` dan `onClose` terpanggil saat tombol ditekan.
* Typecheck (`tsc --noEmit`): 0 error.
* Linter (`eslint`): 0 error.
