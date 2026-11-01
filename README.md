<div align="center">

# DataGuard (DC-Check)

**English** · [Bahasa Indonesia](README.id.md)

**Multi-site data center audit, infrastructure documentation, SIEM, and ISO/IEC 27001 evidence in one web application.**

[![Next.js](https://img.shields.io/badge/Next.js-16.1-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Three.js](https://img.shields.io/badge/Three.js-3D%20racks-000000?logo=threedotjs&logoColor=white)](https://threejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

<img src="Screenshoot/mockup-dashboard-dark.png" alt="DataGuard dashboard" width="880" />

</div>

## Contents

- [Why DataGuard](#why-dataguard)
- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Docker deployment](#docker-deployment)
- [Configuration](#configuration)
- [Database migrations](#database-migrations)
- [Testing](#testing)
- [Security](#security)
- [Project layout](#project-layout)
- [License](#license)

## Why DataGuard

Data center teams often track assets, shift inspections, incidents, and compliance evidence in separate spreadsheets, chat groups, and paper logs. That leaves gaps at handover and a lot of manual work before every audit. DataGuard keeps the physical and technical record of each site in one place: what is installed where, how it was cabled, what the last inspection found, which incidents are open, and which threats and vulnerabilities have been assessed.

Each site is isolated, users can only see the sites they are assigned to, and the interface is available in English and Indonesian.

## Features

### Daily operations

- Shift checklists (`Pagi`, `Siang`, `Malam`) with `OK`, `Warning`, and `Error` states, photo evidence, and in-browser QR scanning to identify equipment.
- A 7-day audit grid that shows the health of every rack and device per day.
- Incidents are created automatically from checklist warnings and errors, with due dates, triage, resolution categories, photo verification, and overdue notifications.
- Quick-connect links (HTTP, HTTPS, SSH, Telnet) on device pages.

### Infrastructure documentation

- Rack layout builder with drag and drop (`@dnd-kit`), U-height collision checks, zones, and room temperature readings.
- 3D rack and room view (Three.js with React Three Fiber): device faceplates, blinking ports, cable paths, holograms for peer devices in the same room, and rack cards for peers in other rooms.
- Room layout editor that also places PAC (precision air conditioning) units and UPS models in the room.
- Device profiles with 2D and 3D location previews.
- Network documentation: port speed, media type (`Copper`, `Fiber`, `DAC`), port mode (`Access`, `Trunk`, `Routed`, `LACP`), VLAN assignments, port-to-port cross-connects, and interactive switch and patch panel faceplates.
- Integration with NCM v4 (network configuration manager): device sync, heartbeat checks, and an ingest API.

### SIEM

- Syslog receiver on UDP 514, TCP 1515, and TLS 6514.
- Parser worker that normalizes RFC 5424 and RFC 3164 messages, with vendor parsers for MikroTik, Cisco, Fortigate, and Linux.
- Rule engine with anomaly, threshold, and sequence rules, a findings dashboard, and IOC lists.
- Alerts by Telegram and email.
- Optional AI triage of findings through an OpenAI-compatible endpoint.
- Response actions that are executed as webhooks only after approval (two-person rule).
- Hourly snapshots for trend history and automatic retention of old events.

### ISO/IEC 27001:2022 evidence

- Threat intelligence register for control A.5.7 and technical vulnerability register for control A.8.8.
- CVSS v3.1 scoring, links to hardware and software assets (including VMs), multiple evidence attachments, and a lifecycle from Open through In Progress to Mitigated.
- Audit PDF (landscape A4 with executive summary, KPI matrix, mitigation ledger, and three signature blocks: prepared, reviewed, approved) and an audit Excel workbook.

### Administration

- Sites, locations, brands, categories, device groups, users, and roles (`Superadmin`, `Admin`, `Staff`).
- Scheduled daily, weekly, and monthly report emails.
- Superadmin backup and restore: a ZIP with a PostgreSQL custom dump and uploaded files, restored in wipe-and-restore or append mode. A backup scheduler keeps daily, weekly, and monthly copies.
- Audit log of every critical change, plus an email log.

## Screenshots

| Operational dashboard | Rack layout |
|:---:|:---:|
| ![Dashboard](Screenshoot/1.jpg) | ![Rack layout](Screenshoot/2.jpg) |

| SIEM findings | 7-day audit grid |
|:---:|:---:|
| ![SIEM findings](Screenshoot/3.jpg) | ![Audit grid](Screenshoot/4.jpg) |

## Architecture

```mermaid
flowchart TB
    subgraph Clients
        Browser["Web browser (Next.js 16 + React 19)"]
        Scanner["Mobile camera QR scanner"]
        Sources["Network devices and servers (syslog)"]
        NCM["NCM v4"]
    end

    subgraph App["Application container (dccheck_app, port 3001)"]
        Router["App Router and server actions"]
        Auth["Session and RBAC (jose JWT)"]
        Export["PDF and Excel export"]
        Upload["Upload pipeline with magic-byte checks"]
    end

    subgraph Workers["Background workers"]
        Syslog["Syslog receiver"]
        Parser["Parser"]
        Rules["Rule engine"]
        Alerts["Alerts (Telegram, SMTP)"]
        AI["AI triage"]
        Response["Response actions"]
        Retention["Retention and snapshots"]
        Ops["Overdue incidents, backups, network-doc sync"]
    end

    DB[("PostgreSQL 15 (Drizzle ORM)")]
    Files[("Uploads and backups volumes")]

    Browser --> Auth --> Router
    Scanner --> Auth
    Router --> Export
    Router --> Upload --> Files
    Router --> DB
    NCM <--> Router
    Sources --> Syslog --> DB
    Parser <--> DB
    Rules <--> DB
    Rules --> Alerts
    AI <--> DB
    Response <--> DB
    Retention <--> DB
    Ops <--> DB
```

## Tech stack

| Area | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Lucide icons, next-intl |
| 3D | three, @react-three/fiber |
| Backend and data | Server actions, Drizzle ORM, PostgreSQL via `pg` |
| Auth | Stateless JWT sessions with `jose`, `bcryptjs` |
| Interaction | `@dnd-kit/core`, `@dnd-kit/sortable` |
| Reports | `jspdf`, `jspdf-autotable`, `xlsx` |
| QR | `qrcode`, `html5-qrcode` |
| Quality | Vitest, TypeScript strict mode, ESLint 9 |

## Getting started

Requirements: Node.js 20 or newer and PostgreSQL 15 or newer.

```bash
git clone https://github.com/torpedoliar/DataGuard.git
cd DataGuard
npm install
```

Create a `.env` file:

```env
DATABASE_URL="postgresql://username:password@localhost:5432/dccheck"
SESSION_SECRET="at-least-32-characters, for example from: openssl rand -base64 32"
AI_KEY_ENCRYPTION_SECRET="another long random secret"
```

Then prepare the database and start the dev server:

```bash
npm run db:migrate     # apply migrations from drizzle/
npm run seed           # base data and the default admin
npm run dev            # http://localhost:3000
```

The seed creates the user `admin` with the password `password`. Change it right after the first login.

## Docker deployment

```bash
cp .env.example.production .env    # fill in DB_*, SESSION_SECRET, AI_KEY_ENCRYPTION_SECRET
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

On a fresh Linux server, `./deploy.sh` brings the stack up in order (database, then the app with schema sync and seed, then the workers) and is safe to run again. On Windows, use `start.bat` or `start-podman.bat` to start and `update.ps1` or `update.bat` to update. The update script never runs `down -v`, never rebuilds or stops the database container, and stops if the database backup fails. [DEPLOYMENT_CONTAINER.md](DEPLOYMENT_CONTAINER.md) explains how to start Docker automatically after a Windows Server reboot.

| Service | Container | Host port | Role |
|---|---|:---:|---|
| `app` | `dccheck_app` | 3001 | Next.js web server |
| `db` | `dccheck_postgres` | 3002 | PostgreSQL |
| `syslog-receiver` | `dccheck_syslog_receiver` | 514/udp, 1515/tcp, 6514/tcp | Syslog intake (plain and TLS) |
| `siem-parser` | `dccheck_siem_parser` | | Normalization and parsing |
| `siem-rules` | `dccheck_siem_rules` | | Detection and correlation rules |
| `siem-alerts` | `dccheck_siem_alerts` | | Telegram and email alerts |
| `siem-ai` | `dccheck_siem_ai` | | AI triage of findings |
| `siem-retention` | `dccheck_siem_retention` | | Event retention |
| `siem-snapshot` | `dccheck_siem_snapshot` | | Hourly trend snapshots |
| `siem-response` | `dccheck_siem_response` | | Approved response actions |
| `incidents-overdue-notify` | `dccheck_incidents_overdue_notify` | | Overdue incident reminders |
| `backup-scheduler` | `dccheck_backup_scheduler` | | Scheduled backups |
| `network-doc-sync` | `dccheck_network_doc_sync` | | Hourly network documentation sync per site |

The TCP and TLS syslog ports can be changed with `SYSLOG_TCP_PORT` and `SYSLOG_TLS_PORT`.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL`, or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | yes | PostgreSQL connection |
| `SESSION_SECRET` | yes | Session signing secret, at least 32 characters |
| `AI_KEY_ENCRYPTION_SECRET` | yes | Encrypts stored AI provider keys. Compose refuses to start without it |
| `SECURE_COOKIES` | no | Force secure cookies behind HTTPS |
| `NEXT_PUBLIC_APP_URL`, `DG_PUBLIC_URL` | no | Public URL used in links and emails |
| `SMTP_URL`, `SMTP_FROM` | no | Outgoing email |
| `NCM_URL`, `NCM_KEY` | no | NCM v4 connection |
| `SIEM_AI_ENDPOINT_URL`, `SIEM_AI_API_KEY`, `SIEM_AI_DEFAULT_MODEL` | no | AI triage provider |
| `BACKUP_DIR`, `BACKUP_SCHEDULE_HOURS`, `BACKUP_RETENTION_DAILY`, `_WEEKLY`, `_MONTHLY` | no | Backup schedule and retention |
| `PURGE_RETENTION_DAYS` | no | SIEM event retention |

Each worker also accepts a poll interval variable, such as `SIEM_PARSER_POLL_INTERVAL_MS`.

## Database migrations

Schema changes are hand-written SQL files in `drizzle/` with an entry in `drizzle/meta/_journal.json`, applied with `npm run db:migrate`. Do not run `drizzle-kit generate` or `push`: the snapshot chain in `drizzle/meta/` stops at migration 0023, so a generated migration would try to recreate tables and columns that already exist. [AGENTS.md](AGENTS.md) has the details.

## Testing

```bash
npm run test         # Vitest suite
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run check        # lint + test + build
```

Tests sit next to the code they cover as `*.test.ts` and `*.test.tsx`.

## Security

- Keep `SESSION_SECRET` at least 32 characters long and never commit `.env` or production secrets.
- Uploads are checked by extension, MIME type, and magic bytes in `lib/upload.ts`.
- Critical changes (users, racks, threat intel, backups) are written to the `audit_logs` table.
- Response actions run only after a second person approves them, and their secrets are kept out of logs.
- Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Project layout

```
app/[locale]/        localized pages: login, site selection, dashboard, checklist, grid, compliance, report, admin
app/api/             health, metrics, cron, uploads, NCM endpoints
actions/             server actions (mutations and queries)
components/          UI grouped by feature, shared UI in components/ui
db/                  Drizzle schema and connection
drizzle/             hand-written SQL migrations
lib/                 domain logic, uploads, sessions, SIEM, reports
scripts/             migrate, seed, and worker entry points
messages/            en.json and id.json translations
```

Contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Released under the [MIT License](LICENSE).

Developed by Yohanes Octavian Rizky ([@torpedoliar](https://github.com/torpedoliar)).
