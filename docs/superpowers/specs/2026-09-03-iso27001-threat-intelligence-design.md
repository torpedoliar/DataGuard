# ISO/IEC 27001 Threat Intelligence & Vulnerability Register Design

## Purpose

Enable automated and auditable tracking of threat intelligence advisories and technical vulnerability mitigations, replacing manual spreadsheet logging. This system aligns directly with **ISO/IEC 27001:2022** requirements:
- **Control A.5.7 (Threat Intelligence)**: Collection and analysis of information relating to information security threats.
- **Control A.8.8 (Management of Technical Vulnerabilities)**: Timely identification, evaluation, patching, and verification of vulnerabilities across organizational assets.

## Scope

### Included in Phase 1:
- **New Navigation Group & Route**: Dedicated `COMPLIANCE` group in the sidebar with a **Threat Intelligence** module at `/compliance/threat-intel`.
- **Structured Logbook**:
  - Tanggal Informasi Threat Intelligence (`intelDate`).
  - Sumber & URL Referensi (`source`, `sourceUrl` e.g., The Hacker News, CISA, Vendor Bulletin).
  - Deskripsi Kerentanan (`title`, `cveList`, `cvssScore`, `severity`, `description`).
  - Aset Terdampak (`affectedAsset` text, with optional hybrid link to physical `devices` and `sites`).
  - Status Siklus Mitigasi (`status`: Open, In Progress, Mitigated, Not Applicable, Accepted Risk).
  - Tanggal Mitigasi (`mitigatedAt`).
  - Tindakan Patching / Mitigasi (`mitigationAction` e.g., firmware/software update version, configuration change, workaround).
- **Multi-evidence Attachments**:
  - Upload multiple evidence images per advisory (vendor advisories, email communications, software version dialogs, patch confirmation screenshots).
  - Safe storage via `lib/upload.ts` in `public/uploads/threat-intel/`.
  - In-app preview using the portaled `PhotoModal`.
- **Compliance Audit Metrics (KPIs)**:
  - Total Threat Advisories.
  - Mitigation Compliance Rate (% Mitigated).
  - Active Threat Count (Open / In Progress).
  - High / Critical Vulnerability Count.
- **Audit Export Deliverables**:
  - **Excel Export (`.xlsx`)**: Aligned 1:1 with the operational spreadsheet structure (`THREAT INTELLIGENCE [YEAR]`) for auditor submissions.
  - **ISO 27001 Audit PDF Report**: Impressive, executive-ready document featuring:
    - Formal compliance header citing ISO/IEC 27001:2022 Controls A.5.7 & A.8.8 and confidentiality markings.
    - Executive summary box with KPI metrics & CVSS severity distribution matrix.
    - Landscape vulnerability & mitigation ledger with color-coded severity and verification references.
    - Formal 3-role auditor sign-off box (*Prepared By*, *Reviewed By*, *Approved / Verified By*).
    - Running headers, footers, timestamp, and page numbers (*Page X of Y*).

### Out of Scope for Phase 1:
- Automated internet crawlers/scrapers for live CVE feeds.
- Automated SIEM rule correlation / log hunting triggers (deferred to Phase 2).

## Status Workflow

`Open` -> `In Progress` -> `Mitigated` (or `Not Applicable` / `Accepted Risk`)

- **Open**: Advisory received and identified; asset exposure under assessment.
- **In Progress**: Remediation, patch testing, or workaround deployment underway.
- **Mitigated**: Patch verified installed or remediation applied with attached evidence.
- **Not Applicable / Accepted Risk**: Organization evaluated and determined asset is not impacted, or risk officially accepted per risk assessment protocol.

## Data Model

### Enums
- `threat_intelligence_status`: `'open'`, `'in_progress'`, `'mitigated'`, `'not_applicable'`, `'accepted_risk'`
- `threat_intelligence_severity`: `'critical'`, `'high'`, `'medium'`, `'low'`

### Tables

#### `threat_intelligences`
| Column | Type | Description |
|---|---|---|
| `id` | serial PK | Primary identifier |
| `site_id` | integer FK (sites) | Nullable: `null` = Global / All sites, integer = Site-scoped |
| `device_id` | integer FK (devices) | Nullable: optional link to hardware inventory device |
| `intel_date` | timestamp | Date threat intel was published / received |
| `source` | text | Advisory source (e.g., "The Hacker News", "CISA", "Veeam") |
| `source_url` | text | Direct reference link / advisory bulletin |
| `title` | text | Vulnerability / Advisory title |
| `cve_list` | text | Comma-separated CVE IDs (e.g. "CVE-2025-59168, CVE-2025-59469") |
| `cvss_score` | real | CVSS Base Score (0.0 to 10.0) |
| `severity` | enum | Computed or assigned severity (Critical/High/Medium/Low) |
| `description` | text | Technical vulnerability summary and impact |
| `affected_asset` | text | Human-readable asset name (e.g. "Veeam Backup & Replication SJA") |
| `status` | enum | Lifecycle status (default: 'open') |
| `mitigated_at` | timestamp | Date remediation / patch was completed |
| `mitigation_action` | text | Patch version, configuration step, or mitigation applied |
| `created_by_id` | integer FK (users) | Author user |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

#### `threat_intelligence_evidences`
| Column | Type | Description |
|---|---|---|
| `id` | serial PK | Evidence identifier |
| `threat_intel_id` | integer FK (threat_intelligences) | Cascade on delete |
| `file_path` | text | Path under `/uploads/threat-intel/` |
| `file_name` | text | Original uploaded filename |
| `file_size` | integer | File size in bytes |
| `mime_type` | text | Verified MIME type |
| `caption` | text | Label (e.g., "Vendor Email", "Version Proof Screenshot") |
| `created_at` | timestamp | Upload timestamp |

### Database Migration
- Hand-written migration `drizzle/0048_threat_intelligence.sql`.
- Updated `drizzle/meta/_journal.json` entry with index 48.
- Applied via `npm run db:migrate`.

## User Interface & Experience

1. **Sidebar Navigation**:
   - New `COMPLIANCE` group rendered for `admin` and `superadmin` roles.
   - Menu item: `Threat Intelligence` (`/compliance/threat-intel`).
2. **Dashboard & List View**:
   - Executive KPI cards: Total Advisories, Mitigation Rate %, Active Open Threats, Critical/High count.
   - Toolbar: Search bar (CVE, Title, Asset), Filter by Status, Filter by Severity, Filter by Site/Year, Export Buttons (Excel, ISO PDF), and `+ New Advisory` button.
   - Responsive Data Table with status pill badges, CVSS color badges (Red for >= 9.0 Critical, Orange for >= 7.0 High, Yellow for >= 4.0 Medium, Blue for Low), evidence thumbnails clickable into `PhotoModal`, and action buttons (Edit, Delete).
3. **Advisory Form Modal**:
   - Clean dialog supporting add and edit operations.
   - Real-time CVSS to severity helper.
   - Hybrid asset input: select from registered devices or type custom asset name.
   - Multi-file drag & drop image uploader with preview tiles and captions.
4. **Export Engines**:
   - **Excel Engine**: Generates `.xlsx` workbook formatted with audit table styling, auto-adjusted column widths, and proper cell formats.
   - **ISO 27001 PDF Engine**: Client/Server PDF generation using `jspdf` & `jspdf-autotable`, rendering formal audit typography, metadata blocks, KPI breakdown, mitigation ledger, and 3-signature approval section.

## Security & Permissions

- Access restricted to `admin` and `superadmin` roles.
- Mutations validated against strict Zod schemas.
- File uploads validated for MIME types, file extensions, and file sizes via `lib/upload.ts`.
- All create, update, and delete actions recorded in `audit_logs` table for ISO audit integrity.

## Verification & Testing

- Unit tests for server actions in `actions/threat-intel.test.ts`.
- Database migration test via `npm run db:migrate`.
- Full TypeScript compilation check via `npm run typecheck`.
- ESLint verification on all new and modified files.
- Manual test verifying evidence upload, status transitions, Excel export, and PDF generation.
