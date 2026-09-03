<div align="center">

# 🛡️ DataGuard (DC-Check)

**Next-Generation Multi-Site Data Center Audit, Infrastructure Management & ISO 27001 Compliance Platform**

[![Next.js 16](https://img.shields.io/badge/Next.js-16.1_(App_Router)-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Tailwind CSS v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169e1?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![ISO 27001 Ready](https://img.shields.io/badge/ISO%2FIEC_27001%3A2022-Compliant-emerald?style=for-the-badge&logo=shield)](https://www.iso.org/standard/27001)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

<br />

<p align="center">
  <img src="Screenshoot/mockup-dashboard-dark.png" alt="DataGuard Dashboard Mockup" width="880" />
</p>

</div>

---

## 📌 Why DataGuard?

Modern data center operations teams often juggle critical assets, equipment audits, incident follow-ups, and compliance requirements across fragmented spreadsheets, chat groups, paper logs, and disparate monitoring tools. This creates audit blind spots, handover vulnerabilities, and compliance audit stress.

**DataGuard** consolidates the entire physical and technical data center lifecycle into a unified, multi-tenant web platform designed for mission-critical operations:

* **Shift Audits & Health Matrix**: Daily equipment inspections with QR scanning, tamper-evident photo proof, and a 7-day visual audit grid.
* **ISO/IEC 27001:2022 Compliance Suite**: Turnkey tracking for **Threat Intelligence (A.5.7)** & **Technical Vulnerabilities (A.8.8)** with CVSS v3.1 scoring, multi-evidence timelines, and 1-click executive audit PDF/Excel exports.
* **Interactive Rack & Layout Builder**: Drag-and-drop equipment placement, collision prevention, U-height verification, and ambient room temperature telemetry.
* **Network & Port Documentation**: Port speeds, media types, VLAN assignments, port-to-port cross-connects, and interactive visual switch faceplates.
* **Incident Center & SLA Follow-Up**: Automated incident generation from audit errors, triage workflows, overdue reminders, and verification sign-offs.
* **Standalone SIEM Engine**: High-throughput UDP 514 syslog ingestion, RFC5424/RFC3164 parsing, rule engines (anomaly, threshold, sequence), and Telegram/Email alerting.
* **Zero-Downtime Backup & Disaster Recovery**: In-app encrypted full-stack ZIP backup and atomic PostgreSQL dump restoration.
* **Bilingual & Multi-Site RBAC**: Native English and Indonesian (Bahasa Indonesia) internationalization with strict multi-site tenant isolation (`Superadmin`, `Admin`, `Staff`).

---

## ⚡ Feature Matrix

| Domain | Key Capabilities |
| --- | --- |
| **🛡️ ISO 27001 Compliance** | **Control A.5.7 (Threat Intel)** & **Control A.8.8 (Vulnerabilities)** register. Automated CVSS severity calculation, hybrid asset linkage (hardware & software/VMs), multi-photo proof attachments, and formal audit sign-off blocks. |
| **📊 Executive Reporting** | 1-Click **ISO 27001 Audit PDF** (Landscape A4, executive summary, KPI matrix, mitigation ledger, 3-role auditor signatures) and **Audit Excel (.xlsx)** aligned with auditor requirements. |
| **📋 Daily Operations Audit** | Shift-based checklist inspections (`Pagi`, `Siang`, `Malam`) with `OK`, `Warning`, and `Error` health states, photo attachments, and full audit logs. |
| **📅 7-Day Audit Grid** | Color-coded matrix timeline showcasing daily operational health per rack and device across the facility. |
| **🚨 Incident Center & SLA** | Automatic incident creation from checklist warnings/errors. Due-date SLA tracking, resolution categorization, photo verification timeline, and overdue alert notifications. |
| **📦 Interactive Rack Layout** | Drag-and-drop rack visualizer with `@dnd-kit`, real-time U-height collision prevention, zone categorization, and room temperature tracking. |
| **🌐 Network Port Faceplates** | Visual interactive switch & patch panel faceplates, media type (`Copper`, `Fiber`, `DAC`), port modes (`Access`, `Trunk`, `Routed`, `LACP`), and VLAN mapping. |
| **🔍 SIEM & Syslog Receiver** | Standalone UDP 514 ingestion worker, RFC5424/RFC3164 vendor normalizers (MikroTik, Cisco, Fortigate, Linux), detection rule engine, findings dashboard, and automated log pruning. |
| **📱 QR Scanner & Remote Links** | In-browser QR camera scanner for instantaneous equipment identification, plus 1-click HTTP, HTTPS, SSH, and Telnet quick-connect buttons. |
| **⏰ Automated Report Scheduler** | Background worker delivering scheduled daily/weekly/monthly PDF & summary email digests to stakeholders. |
| **💾 Disaster Recovery** | Superadmin ZIP backup bundling PostgreSQL custom dump and upload assets with atomic wipe-and-restore or append modes. |
| **🌍 i18n & Multi-Site RBAC** | `next-intl` dual-language support (English & Indonesian) and strict multi-site tenant switching. |

---

## 🖼️ Visual Tour

<div align="center">

| Operational Dashboard | Interactive Rack Layout |
|:---:|:---:|
| ![Dashboard](Screenshoot/1.jpg) | ![Rack Layout](Screenshoot/2.jpg) |

| SIEM Findings & Signals | 7-Day Audit Grid Matrix |
|:---:|:---:|
| ![SIEM Findings](Screenshoot/3.jpg) | ![Audit Grid](Screenshoot/4.jpg) |

</div>

---

## 🏛️ System Architecture

```mermaid
flowchart TB
    subgraph Clients["Presentation & Edge"]
        Browser["🖥️ Web Browser / PWA (Next.js 16 + React 19)"]
        Scanner["📱 Mobile / Camera QR Scanner"]
        SyslogSources["📡 Network Devices / Servers (Syslog UDP:514)"]
    end

    subgraph AppServer["Core Application Server (Node.js / Turbopack)"]
        AppRouter["App Router & Server Actions"]
        Auth["Session & RBAC Guard (JWT + jose)"]
        ExportEngines["Audit Export Engine (jsPDF + xlsx)"]
        UploadHandler["Safe Upload Pipeline (Magic-Byte Guard)"]
    end

    subgraph SIEMWorkers["Asynchronous Background Workers"]
        SyslogReceiver["UDP 514 Syslog Ingest Engine"]
        ParserWorker["RFC Normalization & Parser Worker"]
        RuleWorker["Rule & Correlation Engine"]
        AlertWorker["Alert Dispatcher (Telegram / SMTP)"]
        RetentionWorker["Data Lifecycle & Pruning Worker"]
        ReportWorker["Automated Report Scheduler Worker"]
    end

    subgraph Persistence["Storage & Database Layer"]
        Postgres[("🗄️ PostgreSQL 15+ (Drizzle ORM)")]
        Volume[("📁 Storage Volume (/uploads & /backups)")]
    end

    Browser --> Auth
    Scanner --> Auth
    Auth --> AppRouter
    AppRouter --> ExportEngines
    AppRouter --> UploadHandler
    AppRouter --> Postgres
    UploadHandler --> Volume

    SyslogSources --> SyslogReceiver
    SyslogReceiver --> Postgres
    ParserWorker <--> Postgres
    RuleWorker <--> Postgres
    RuleWorker --> AlertWorker
    AlertWorker --> Browser
    RetentionWorker <--> Postgres
    ReportWorker <--> Postgres
    ReportWorker --> AlertWorker
```

---

## 🛠️ Technology Stack

* **Frontend**: [Next.js 16](https://nextjs.org/) (App Router, Turbopack), [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Lucide Icons](https://lucide.dev/)
* **Backend & ORM**: Node.js Server Actions, [Drizzle ORM](https://orm.drizzle.team/), PostgreSQL via `pg`
* **Security & Auth**: Stateless JWT via [`jose`](https://github.com/panva/jose), [`bcryptjs`](https://github.com/dcodeIO/bcrypt.js)
* **Drag-and-Drop & Interactions**: [`@dnd-kit/core`](https://dndkit.com/), [`@dnd-kit/sortable`](https://dndkit.com/)
* **Document & Report Generation**: [`jspdf`](https://github.com/parallax/jsPDF), [`jspdf-autotable`](https://github.com/simonbengtsson/jsPDF-AutoTable), [`xlsx`](https://sheetjs.com/)
* **QR Codes & Scanning**: [`qrcode`](https://github.com/soldair/node-qrcode), [`html5-qrcode`](https://github.com/mebjas/html5-qrcode)
* **Testing & Quality**: [Vitest](https://vitest.dev/), TypeScript Strict Mode (`tsc --noEmit`), ESLint 9

---

## 🚀 Quick Start

### 1. Prerequisites
* **Node.js**: v20.x or higher
* **PostgreSQL**: v15.x or higher
* **npm** or **pnpm**

### 2. Local Setup

```bash
# Clone the repository
git clone https://github.com/torpedoliar/DataGuard.git
cd DataGuard

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

Edit `.env` and set your database connection and session secret:
```env
DATABASE_URL="postgresql://username:password@localhost:5432/dccheck"
SESSION_SECRET="generate-a-secure-secret-with-openssl-rand-base64-32"
```

```bash
# Apply database migrations
npm run db:migrate

# Seed initial system structure and default admin
npm run seed

# Start the local development server (Turbopack)
npm run dev
```

Open `http://localhost:3000` in your browser.

**Default Seeded Credentials:**
* **Username**: `admin`
* **Password**: `password`
*(⚠️ Please change the default password immediately upon first login)*

---

## 🐳 Docker Deployment

DataGuard ships with production-ready `Dockerfile` and `docker-compose.yml` configurations orchestrating the core web application, PostgreSQL database, and standalone SIEM background workers.

```bash
# Start all services in the background
docker compose up -d --build

# Inspect active services
docker compose ps

# Follow real-time application logs
docker compose logs -f app
```

### Deployed Services

| Service | Container Name | Host Port | Role |
| --- | --- | :---: | --- |
| `app` | `dc-check-app` | `3001` | Next.js 16 Web Server |
| `db` | `dc-check-db` | `3002` | PostgreSQL Database Service |
| `syslog-receiver` | `dc-check-syslog` | `514/udp` | High-Throughput Syslog Receiver |
| `siem-parser` | `dc-check-siem-parser` | - | Syslog Normalization & Parser Worker |
| `siem-rules` | `dc-check-siem-rules` | - | Detection & Correlation Rule Engine |
| `siem-alerts` | `dc-check-siem-alerts` | - | Telegram & Email Alert Worker |
| `siem-retention` | `dc-check-siem-retention` | - | Automatic Event Retention Worker |

---

## 📜 ISO/IEC 27001:2022 Compliance Module

DataGuard provides out-of-the-box audit documentation conforming to international security standards:

```text
ISO/IEC 27001:2022 ISMS Controls:
├── Control A.5.7: Threat Intelligence
│   ├── Collection, recording, and impact evaluation of threat advisories
│   └── Source bulletin verification and cross-referencing
└── Control A.8.8: Management of Technical Vulnerabilities
    ├── Tracking vulnerability lifecycle (Open → In Progress → Mitigated)
    ├── Standard CVSS v3.1 calculation (Critical, High, Medium, Low)
    ├── Multi-evidence repository (Email bulletins, software version dialogs, logs)
    └── 3-Role Audit Sign-Off Ledger (Prepared, Reviewed, and Approved by Lead Auditor)
```

### Executive Audit Report Previews
* **Audit Excel (.xlsx)**: Directly formatted with standard threat advisory ledgers for external auditor submission.
* **Audit PDF Report**: Elegant landscape A4 document featuring executive KPI metrics, severity distribution matrices, full mitigation evidence tables, and formal signature authorization boxes.

---

## 🧪 Testing & Quality Assurance

DataGuard maintains rigorous test-driven standards across data pipelines, backup routines, security validations, and UI components:

```bash
# Run the complete Vitest test suite
npm run test

# Run TypeScript compilation check
npm run typecheck

# Run ESLint analysis
npm run lint

# Execute full validation pipeline (lint, test, build)
npm run check
```

---

## 🔒 Security Best Practices

1. **Session Protection**: Ensure `SESSION_SECRET` is at least 32 characters (`openssl rand -base64 32`).
2. **Secret Rotation**: Never commit `.env` or production secrets. Use production secret managers or encrypted environment files.
3. **Upload Sanitization**: Uploaded files undergo extension, MIME type, and magic-byte inspection via `lib/upload.ts` to prevent arbitrary file upload vulnerabilities.
4. **Audit Trail**: Every critical mutation (user management, rack changes, threat intel updates, backups) is immutably written to the `audit_logs` table.

---

## 📄 License

DataGuard is open-source software released under the **[MIT License](LICENSE)**.

---

<div align="center">
  <sub>Built with ❤️ for Data Center Engineers, DevOps, and Information Security Teams.</sub>
</div>
