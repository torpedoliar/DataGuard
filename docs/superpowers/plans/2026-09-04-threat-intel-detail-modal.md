# Threat Intelligence Case Reader Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated case reader modal popup for Threat Intelligence advisories so users can read full vulnerability cases cleanly with ISO 27001 metadata, NVD links, mitigation details, and evidence photos by clicking threat titles or dedicated view buttons.

**Architecture:** A presentation modal `ThreatIntelDetailModal` using `Modal` from `components/ui/modal.tsx`, integrated into `ThreatIntelTable` via clickable title and action button, orchestrated in `ThreatIntelClient` with full photo inspection support via `PhotoModal`.

**Tech Stack:** React 19, Next.js 16, Tailwind CSS v4, Lucide React icons, Vitest.

## Global Constraints
- Strictly TypeScript with strict mode and `@/*` path alias.
- Maintain dark and light mode theme consistency using `bg-ops-*` and `text-ops-*` tokens.
- Comply with ISO/IEC 27001:2022 Control A.5.7 & A.8.8 fields.
- 0 lint errors, 0 typecheck errors, passing unit tests.

---

### Task 1: Create `ThreatIntelDetailModal` Component & Unit Tests

**Files:**
- Create: `components/compliance/threat-intel-detail-modal.tsx`
- Create: `components/compliance/threat-intel-detail-modal.test.tsx`

**Interfaces:**
- Consumes:
  - `ThreatIntelRecord` from `@/lib/threat-intel`
  - `Modal` from `@/components/ui/modal`
  - `StatusBadge` from `@/components/ui/status-badge`
  - `ActionButton` from `@/components/ui/action-button`
- Produces:
  - `ThreatIntelDetailModal({ item, open, onClose, onEdit, onViewPhoto }: ThreatIntelDetailModalProps)`

- [ ] **Step 1: Write the failing unit tests for `ThreatIntelDetailModal`**
Write tests asserting header rendering, CVSS score badge, CVE tags with NVD links, affected asset, technical description, mitigation card, evidence gallery, and action buttons.

- [ ] **Step 2: Run test to verify it fails**
Run `npx vitest run components/compliance/threat-intel-detail-modal.test.tsx` and verify failure because component is not yet implemented.

- [ ] **Step 3: Implement `ThreatIntelDetailModal`**
Build the modal with clean layout, responsive typography, scrollable body, CVSS pill, clickable CVE badges to NVD, mitigation card, evidence thumbnails, and Edit/Close footer.

- [ ] **Step 4: Run test to verify it passes**
Run `npx vitest run components/compliance/threat-intel-detail-modal.test.tsx` and verify 100% pass.

---

### Task 2: Update `ThreatIntelTable` with Clickable Title and View Button

**Files:**
- Modify: `components/compliance/threat-intel-table.tsx`

**Interfaces:**
- Consumes: `onViewDetail?: (item: ThreatIntelRecord) => void` in `ThreatIntelTableProps`
- Produces: Clickable threat title and Eye icon button in the action column calling `onViewDetail(item)`.

- [ ] **Step 1: Add `onViewDetail` to `ThreatIntelTableProps` and trigger buttons**
Update table headers, title rendering with hover/underline button, and add `IconButton` with `Eye` icon in the Actions column.

- [ ] **Step 2: Verify existing unit tests for compliance still pass**
Run `npx vitest run components/compliance/` to verify table changes don't break existing tests.

---

### Task 3: Integrate Detail Modal into `ThreatIntelClient`

**Files:**
- Modify: `components/compliance/threat-intel-client.tsx`

**Interfaces:**
- Consumes: `ThreatIntelDetailModal` from `@/components/compliance/threat-intel-detail-modal`
- Produces: State `viewingItem: ThreatIntelRecord | null` and wired handlers for `onViewDetail`, `onEdit`, and `onViewPhoto`.

- [ ] **Step 1: Add `viewingItem` state and wire to table and modal**
Update `ThreatIntelClient` to pass `onViewDetail={setViewingItem}` to `ThreatIntelTable` and render `ThreatIntelDetailModal`.

- [ ] **Step 2: Verify seamless transition to Edit and Photo zoom**
When "Edit Advisory" is clicked in the detail modal, it closes detail modal and opens `ThreatIntelFormModal`. When photo thumbnail is clicked, it opens `PhotoModal`.

---

### Task 4: Full Quality Gate Verification

**Files:**
- Check all modified and created files.

- [ ] **Step 1: Run TypeScript check**
Run `npm run typecheck` and ensure 0 errors.

- [ ] **Step 2: Run ESLint**
Run `npm run lint` on touched files and ensure 0 errors.

- [ ] **Step 3: Run Vitest test suite**
Run `npx vitest run components/compliance/` and ensure all tests pass.
