# ISO 27001 Threat Intelligence & Vulnerability Register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auditable ISO/IEC 27001:2022 (A.5.7 Threat Intel & A.8.8 Technical Vulnerabilities) logbook module in DC-Check with hybrid asset tracking, multi-evidence uploads, Excel export, and an impressive executive audit PDF report.

**Architecture:** A dedicated database schema (`threat_intelligences` & `threat_intelligence_evidences`) managed via hand-written Drizzle SQL migrations. Server actions in `actions/threat-intel.ts` enforce RBAC (Admin/Superadmin), active-site scoping, file sanitization via `lib/upload.ts`, and audit trail logging. The frontend features a new `COMPLIANCE` sidebar group, KPI summary cards, tabular listing matching the user's spreadsheet, `PhotoModal` evidence viewing, and export engines for Excel and styled ISO 27001 PDF reports.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4, Drizzle ORM + PostgreSQL, Lucide React, Zod, xlsx, jspdf + jspdf-autotable, Vitest.

## Global Constraints
- Hand-written migration only (`drizzle/0048_threat_intelligence.sql`) + `_journal.json` update. Do not run `db:generate` or `db:push`.
- Access restricted to `admin` and `superadmin` roles.
- Evidence files stored in `public/uploads/threat-intel/` using `saveUploadFile`.
- All mutations logged to `audit_logs`.
- Full TypeScript strictness (`npm run typecheck`) and clean ESLint checks (`npm run lint`).

---

### Task 1: Database Migration & Drizzle Schema

**Files:**
- Create: `drizzle/0048_threat_intelligence.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `db/schema.ts`
- Test: migration execution via `npm run db:migrate`

**Interfaces:**
- Produces: `threatIntelligences`, `threatIntelligenceEvidences`, `threatIntelligenceStatusEnum`, `threatIntelligenceSeverityEnum` exported from `db/schema.ts`.

- [ ] **Step 1: Create hand-written migration SQL**
Write `drizzle/0048_threat_intelligence.sql` defining `threat_intelligence_status`, `threat_intelligence_severity`, `threat_intelligences`, and `threat_intelligence_evidences` tables with indexes and foreign keys.

- [ ] **Step 2: Register migration in `drizzle/meta/_journal.json`**
Add index 48 entry to `_journal.json`.

- [ ] **Step 3: Update `db/schema.ts`**
Export the Drizzle pgTable definitions and pgEnum types corresponding to the SQL schema.

- [ ] **Step 4: Execute database migration**
Run: `npm run db:migrate`
Expected: Migration 0048 applied successfully.

- [ ] **Step 5: Commit**
```bash
git add drizzle/ db/schema.ts
git commit -m "feat(db): add threat intelligence and evidence tables migration"
```

---

### Task 2: Server Actions & Backend Validation

**Files:**
- Create: `actions/threat-intel.ts`
- Test: `actions/threat-intel.test.ts`
- Modify: `lib/audit.ts` (if action type needs registration)

**Interfaces:**
- Produces: `getThreatIntelligences`, `getThreatIntelById`, `createThreatIntel`, `updateThreatIntel`, `deleteThreatIntel` exported from `actions/threat-intel.ts`.

- [ ] **Step 1: Write the failing unit tests for actions**
Create `actions/threat-intel.test.ts` testing input validation, severity calculation from CVSS score, status filtering, and permission guards.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run actions/threat-intel.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `actions/threat-intel.ts`**
Implement Zod validation schema, site-scoped queries, file upload processing via `saveUploadFile`, CRUD mutations, and audit logging into `audit_logs`.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run actions/threat-intel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add actions/threat-intel.ts actions/threat-intel.test.ts
git commit -m "feat(actions): implement threat intelligence server actions and validations"
```

---

### Task 3: Navigation & Route Scaffolding

**Files:**
- Modify: `lib/ui/navigation.ts`
- Modify: `components/ui/app-shell.tsx`
- Create: `app/[locale]/(dashboard)/compliance/threat-intel/page.tsx`

**Interfaces:**
- Consumes: `getAppNavigation` from `lib/ui/navigation.ts`
- Produces: `/compliance/threat-intel` dashboard route under the new `COMPLIANCE` group.

- [ ] **Step 1: Add `COMPLIANCE` group to `lib/ui/navigation.ts`**
Add group with label "Compliance" containing NavItem for `/compliance/threat-intel` visible to `admin` and `superadmin`.

- [ ] **Step 2: Ensure icon mapping in `components/ui/app-shell.tsx`**
Ensure Lucide icon `ShieldCheck` (or `ShieldAlert`) is mapped for the navigation item.

- [ ] **Step 3: Create route page**
Create `app/[locale]/(dashboard)/compliance/threat-intel/page.tsx` loading initial data using `getThreatIntelligences` and active site context.

- [ ] **Step 4: Run typecheck**
Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**
```bash
git add lib/ui/navigation.ts components/ui/app-shell.tsx app/\[locale\]/\(dashboard\)/compliance/
git commit -m "feat(nav): add compliance threat intelligence route and navigation"
```

---

### Task 4: UI Components (KPI Cards, Table, Form Modal, Evidence Preview)

**Files:**
- Create: `components/compliance/threat-intel-client.tsx`
- Create: `components/compliance/threat-intel-table.tsx`
- Create: `components/compliance/threat-intel-form-modal.tsx`
- Create: `components/compliance/threat-intel-kpi.tsx`
- Test: `components/compliance/threat-intel.test.tsx`

**Interfaces:**
- Consumes: `PhotoModal` from `components/report/photo-modal.tsx`
- Produces: interactive compliance table with status badges, CVSS badges, multi-image upload modal, and filter toolbar.

- [ ] **Step 1: Write unit test for UI components**
Create `components/compliance/threat-intel.test.tsx` verifying KPI rendering and table layout.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run components/compliance/threat-intel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement KPI summary and Table components**
Implement `threat-intel-kpi.tsx` and `threat-intel-table.tsx` rendering columns: Tanggal Info, Sumber, Deskripsi (CVE & CVSS badge), Aset Terdampak, Status, Tanggal Mitigasi, Tindakan Patch, Bukti (thumbnail + PhotoModal), Actions.

- [ ] **Step 4: Implement Add/Edit Modal Dialog**
Implement `threat-intel-form-modal.tsx` with hybrid asset selector (dropdown + custom input), CVSS helper, and multi-file evidence uploader.

- [ ] **Step 5: Implement parent client orchestrator**
Implement `threat-intel-client.tsx` coordinating state, filtering, search, and modal triggers.

- [ ] **Step 6: Run test to verify it passes**
Run: `npx vitest run components/compliance/threat-intel.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add components/compliance/
git commit -m "feat(ui): add threat intelligence KPI, table, and form modal components"
```

---

### Task 5: Audit Export Engines (Excel & Impressive ISO 27001 PDF)

**Files:**
- Create: `lib/compliance/threat-intel-export.ts`
- Create: `lib/compliance/threat-intel-pdf.ts`
- Modify: `components/compliance/threat-intel-client.tsx` (wire export handlers)
- Test: `lib/compliance/threat-intel-export.test.ts`

**Interfaces:**
- Produces: `exportThreatIntelToExcel(items, siteName)`, `generateIso27001ThreatIntelPdf(items, siteName, metadata)`

- [ ] **Step 1: Write export unit tests**
Create `lib/compliance/threat-intel-export.test.ts` testing Excel row mapping and PDF data generation structure.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run lib/compliance/threat-intel-export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Excel export utility**
Using `xlsx`, format rows matching the user's `THREAT INTELLIGENCE 2026` layout with appropriate column widths and headers.

- [ ] **Step 4: Implement Impressive ISO 27001 PDF generator**
Using `jspdf` and `jspdf-autotable`, render:
- Corporate compliance banner and ISO/IEC 27001:2022 A.5.7 & A.8.8 title.
- Executive summary KPI widgets and severity breakdown matrix.
- Landscape mitigation ledger table with dark corporate headers and status highlights.
- Formal 3-column auditor sign-off box (*Prepared By*, *Reviewed By*, *Approved / Verified By*).
- Confidentiality notices, timestamps, and page numbering.

- [ ] **Step 5: Wire export actions into client toolbar**
Connect buttons in `threat-intel-client.tsx` to trigger Excel download and PDF generation.

- [ ] **Step 6: Run tests and verify passes**
Run: `npx vitest run lib/compliance/threat-intel-export.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add lib/compliance/ components/compliance/
git commit -m "feat(export): add Excel and impressive ISO 27001 audit PDF export generators"
```

---

### Task 6: Final Verification & Integration Testing

**Files:**
- All touched files

- [ ] **Step 1: Run complete test suite**
Run: `npm run test`
Expected: All relevant tests pass.

- [ ] **Step 2: Run TypeScript typecheck**
Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run ESLint**
Run: `npx eslint components/compliance/ actions/threat-intel.ts lib/compliance/`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Final commit**
```bash
git commit --allow-empty -m "chore(compliance): verify complete ISO 27001 threat intelligence module"
```
