# DC-Check

## Project Overview
DC-Check is a multi-site **Data Center Audit & Infrastructure Management System** built with a modern web stack. It enables operations teams to monitor equipment health, manage rack layouts, track network ports, and generate compliance reports. The system uses a multi-site Role-Based Access Control (RBAC) architecture with `Superadmin`, `Admin`, and `Staff` roles.

An active effort is underway to integrate a **SIEM (Security Information and Event Management)** capability into the platform, featuring a standalone Syslog receiver, parser/normalization engine, rule engine, alerting, and incident integration.

### Tech Stack
- **Framework:** Next.js 16 (App Router, Turbopack)
- **Frontend:** React 19, Tailwind CSS v4, Lucide React
- **Backend:** Node.js, Server Actions
- **Database & ORM:** PostgreSQL via `pg`, Drizzle ORM
- **Testing:** Vitest
- **Validation:** Zod
- **Drag & Drop:** `@dnd-kit`

## Building and Running

### Setup
1. Install dependencies: `npm install`
2. Environment: Copy `.env.example` to `.env` and set `DATABASE_URL` and `SESSION_SECRET` (generate secret with `openssl rand -base64 32`).

### Database Commands
- `npm run db:generate` - Generate Drizzle migration SQL files
- `npm run db:migrate` - Apply pending migrations
- `npm run db:push` - Push schema changes directly to the database
- `npm run seed` - Seed initial database structure
- `npm run db:studio` - Open Drizzle Studio visual GUI

### Application Servers
- `npm run dev` - Start development server (Turbopack)
- `npm run build` - Build the Next.js application for production
- `npm run start` - Start production server

### SIEM Background Workers
The SIEM capabilities require long-running background workers:
- `npm run syslog:receiver` - Starts UDP 514 syslog receiver
- `npm run siem:parser` - Starts parsing & normalization worker
- `npm run siem:rules` - Starts rule engine worker
- `npm run siem:alerts` - Starts alert worker
- `npm run siem:retention` - Starts data retention worker

### Testing and Linting
- `npm run test` - Run Vitest test suite
- `npm run lint` - Run ESLint
- `npm run check` - Run lint, test, and build pipelines in sequence

## Development Conventions

### Architecture & Structure
- **App Router:** Built on Next.js App Router (`app/`). Protected dashboard routes reside in `app/(dashboard)/`.
- **Server Actions:** Data mutations and queries are implemented as Next.js Server Actions in the `actions/` directory.
- **UI Components:** Reusable and domain-specific components are organized inside `components/` (e.g., `admin`, `checklist`, `grid`).
- **Database:** The database layer uses Drizzle ORM with definitions centralized in `db/schema.ts`.

### SIEM Implementation Guidelines
- **Worker Separation:** The syslog receiver is a standalone process, *not* a Next.js route. Keep the receiver path lightweight: accept packets and batch database writes.
- **Data Immutability:** Raw syslog data is immutable and must be stored separately from parsed events.
- **Layered Processing:** Enforce strict separation between parsing, normalization, enrichment, and rule analysis.
- **Security:** Ensure raw logs are properly sanitized/escaped before rendering in the UI. Automatically redact secrets from logs prior to alerting or downstream AI analysis.
- **Testing Standard:** Follow test-driven practices for SIEM phases. Write tests before delivering production code. Ensure all generated findings map back to sample event IDs.