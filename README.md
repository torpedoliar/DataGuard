<![CDATA[# 🏢 DC-Check — Data Center Audit & Infrastructure Management

[![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2.3-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite)](https://sqlite.org/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?logo=drizzle)](https://orm.drizzle.team/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](#license)

A comprehensive, multi-site **Data Center Audit & Infrastructure Management System** built for operations teams to monitor equipment health, manage rack layouts, track network ports, and generate compliance reports — all from a single, modern web interface.

---

## ✨ Key Features

### 🔐 Authentication & Multi-Site RBAC
- **JWT-based sessions** with secure `bcryptjs` password hashing
- **Three-tier role system**: `Superadmin` → `Admin` → `Staff`
- **Multi-site architecture** — each site has its own devices, racks, VLANs, and checklists
- **Superadmin**: full access to **all sites**, can switch freely between them
- **Admin**: manages only their **assigned site(s)**
- **Staff**: performs daily checklists on their assigned site

### 📋 Daily Audit Checklists
- Structured equipment inspections with **OK / Warning / Error** status per device
- **Photo documentation** — attach evidence photos to checklist items
- **Shift-based tracking** (Pagi / Siang / Malam) with timestamps
- Quick entry with smart device grouping by category

### 📊 Dashboard & Analytics
- Real-time **completion statistics** and activity feed
- **Compliance trends**, failure analysis, and KPI tracking
- Device health trend visualization

### 📅 Audit Grid
- **7-day matrix view** of equipment status history across all devices
- Color-coded cells for instant visual assessment (OK/Warning/Error)

### 🗄️ Visual Rack Management
- **Interactive rack layout** with drag-and-drop device placement (powered by `@dnd-kit`)
- **Device swapping** — drag a device onto an occupied slot to automatically swap positions
- **Collision detection** — prevents overlapping U-positions
- Per-rack visualization with configurable U-height (1U–60U)
- Zone-based rack grouping

### 🔌 Network Infrastructure
- **Network port management** per device (port name, MAC, IP, speed, media type)
- **Port modes**: Access, Trunk, Routed, LACP
- **VLAN management** with subnet tracking
- **Port-to-port connectivity mapping** — track which device connects to what
- Speed options from 10/100M up to 100G

### 🏷️ Brand & Category Management
- Device brands with **logo upload** support
- Color-coded device categories
- Filterable and sortable device tables

### 📍 Location Management
- Per-site room/location definitions
- Assign devices and racks to specific physical locations

### 📡 Remote Device Access
- **One-click remote access** modal for devices with IP addresses
- Supports **HTTP**, **HTTPS**, **SSH**, and **Telnet** protocol links
- **Custom port** input — specify non-standard ports (e.g., `8080`, `2222`)

### 📱 QR Code
- **Generate & print QR codes** per device for fast identification
- QR scanner integration via `html5-qrcode`

### 📤 Export & Reporting
- **Excel export** (`.xlsx`) of compliance and audit reports
- **PDF generation** with `jspdf` + `jspdf-autotable`
- Filterable report page with date range, shift, and operator selection

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Next.js 16.1.6](https://nextjs.org/) (App Router, Turbopack) |
| **Frontend** | [React 19.2.3](https://react.dev/), TypeScript 5 |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) |
| **Database** | [SQLite](https://sqlite.org/) via `better-sqlite3` |
| **ORM** | [Drizzle ORM](https://orm.drizzle.team/) 0.45 |
| **Auth** | JWT ([jose](https://github.com/panva/jose)) + [bcryptjs](https://www.npmjs.com/package/bcryptjs) |
| **Validation** | [Zod](https://zod.dev/) |
| **Drag & Drop** | [@dnd-kit](https://dndkit.com/) |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **QR Code** | [qrcode](https://www.npmjs.com/package/qrcode) + [html5-qrcode](https://www.npmjs.com/package/html5-qrcode) |
| **Export** | [xlsx](https://www.npmjs.com/package/xlsx), [jspdf](https://www.npmjs.com/package/jspdf) |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+ (tested up to v25.x)
- **npm** (comes with Node.js)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/torpedoliar/DataGuard.git
cd dc-check

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and set SESSION_SECRET (min 32 characters)
# Generate one with: openssl rand -base64 32

# 4. Set up the database
npm run db:generate      # Generate migration files
npm run db:migrate       # Apply migrations
npm run seed             # Seed initial data (admin user + sample data)

# 5. Start the development server
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### Quick Start (Windows)

Double-click `start.bat` — it will auto-install dependencies (if needed) and launch the dev server.

### Default Credentials

```
Username: admin
Password: password
```

> ⚠️ **Change the default password immediately after first login!**

---

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (Turbopack) |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push schema changes directly to database |
| `npm run db:generate` | Generate migration SQL files |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio (visual database GUI) |
| `npm run seed` | Seed database with initial data |
| `npm run seed:users` | Seed only user accounts |
| `npm run reset:devices` | Reset all device data |

---

## 🗄️ Database Schema

```mermaid
erDiagram
    SITES ||--o{ USER_SITES : has
    SITES ||--o{ DEVICES : contains
    SITES ||--o{ RACKS : contains
    SITES ||--o{ LOCATIONS : contains
    SITES ||--o{ VLANS : contains
    SITES ||--o{ CHECKLIST_ENTRIES : has

    USERS ||--o{ USER_SITES : assigned_to
    USERS ||--o{ CHECKLIST_ENTRIES : creates

    USER_SITES {
        int userId FK
        int siteId FK
        text roleInSite "admin | staff"
    }

    CATEGORIES ||--o{ DEVICES : classifies
    BRANDS ||--o{ DEVICES : manufactures
    LOCATIONS ||--o{ DEVICES : houses
    LOCATIONS ||--o{ RACKS : houses

    DEVICES ||--o{ CHECKLIST_ITEMS : inspected_in
    DEVICES ||--o{ NETWORK_PORTS : has

    CHECKLIST_ENTRIES ||--o{ CHECKLIST_ITEMS : contains

    VLANS ||--o{ NETWORK_PORTS : assigned_to

    NETWORK_PORTS ||--o| NETWORK_PORTS : connected_to
```

### Tables Overview

| Table | Scope | Description |
|-------|-------|-------------|
| `sites` | Global | Data center sites with code, address, Telegram integration |
| `users` | Global | User accounts (`superadmin` / `admin` / `staff`) |
| `user_sites` | Global | User ↔ Site assignments with role-in-site |
| `categories` | Global | Device categories (Server, Network Device, UPS, etc.) |
| `brands` | Global | Equipment brands with logo support |
| `locations` | Per-site | Physical rooms/areas within a site |
| `racks` | Per-site | Server racks with zone and U-height config |
| `devices` | Per-site | Equipment with IP, rack position, brand, photos |
| `vlans` | Per-site | VLAN definitions with subnet info |
| `network_ports` | Per-site | Port details, connectivity, speed, media type |
| `checklist_entries` | Per-site | Daily audit headers (date, shift, operator) |
| `checklist_items` | Per-site | Individual device check results + photo evidence |

---

## 📂 Project Structure

```
dc-check/
├── app/                          # Next.js App Router
│   ├── (dashboard)/              # Protected routes (requires auth)
│   │   ├── admin/                # Admin panel
│   │   │   ├── brands/           # Brand management
│   │   │   ├── categories/       # Category management
│   │   │   ├── devices/          # Device details & network ports
│   │   │   ├── locations/        # Room/location management
│   │   │   ├── network/          # Global VLAN management
│   │   │   ├── rack/             # Visual rack layout (drag & drop)
│   │   │   ├── rack-manage/      # Rack CRUD table
│   │   │   ├── sites/            # Multi-site management
│   │   │   ├── users/            # User management
│   │   │   └── page.tsx          # Admin dashboard (Master Data)
│   │   ├── checklist/            # Daily audit checklist
│   │   ├── grid/                 # 7-day audit grid view
│   │   ├── report/               # Reports & export
│   │   └── layout.tsx            # Dashboard layout + Navbar + Site Switcher
│   ├── audit/                    # QR-code audit entry
│   ├── login/                    # Authentication page
│   └── page.tsx                  # Landing / redirect
├── actions/                      # Server Actions (mutations & queries)
│   ├── auth.ts                   # Login, logout, switch site
│   ├── checklist.ts              # Checklist CRUD
│   ├── master-data.ts            # Device CRUD, toggle status, takeout
│   ├── rack-management.ts        # Rack CRUD
│   ├── rack-layout.ts            # Rack visual data fetching
│   ├── network.ts                # VLAN & network port management
│   ├── brands.ts                 # Brand CRUD with logo upload
│   ├── locations.ts              # Location CRUD
│   ├── sites.ts                  # Site management & user assignment
│   ├── users.ts                  # User CRUD
│   ├── report.ts                 # Report data queries
│   ├── grid.ts                   # Audit grid data
│   ├── dashboard.ts              # Dashboard statistics
│   ├── analytics.ts              # Trend analytics
│   └── qr.ts                     # QR code generation
├── components/                   # React components
│   ├── admin/                    # 31 admin components (tables, forms, modals)
│   ├── checklist/                # Checklist form components
│   ├── grid/                     # Grid view component
│   ├── report/                   # Report & export components
│   └── ui/                       # Shared UI (Navbar, site switcher)
├── db/                           # Database layer
│   ├── schema.ts                 # Drizzle ORM schema (10 tables + relations)
│   └── index.ts                  # SQLite connection
├── lib/                          # Utilities
│   ├── session.ts                # JWT session management
│   ├── site-access.ts            # Multi-site access control helpers
│   └── rack-validation.ts        # Rack collision detection logic
├── drizzle/                      # Generated SQL migrations
├── scripts/                      # CLI utilities (seed, migrate, reset)
├── public/uploads/               # Uploaded photos & brand logos
├── middleware.ts                  # Route protection & session verification
├── start.bat                     # Windows dev launcher
└── start-prod.bat                # Windows production launcher
```

---

## ⚙️ Environment Variables

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `DB_FILE_NAME` | No | `sqlite.db` | SQLite database file path |
| `SESSION_SECRET` | **Yes** | — | JWT signing secret (min 32 characters) |
| `UPLOAD_DIR` | No | `./public/uploads` | Directory for uploaded files |
| `MAX_FILE_SIZE` | No | `5242880` | Maximum upload size in bytes (default 5 MB) |

---

## 🏗️ Production Deployment

### Build & Run

```bash
# Build optimized production bundle
npm run build

# Start production server
npm run start

# Or use the Windows batch launcher
start-prod.bat
```

### Database Backup & Restore

The SQLite database is a single file — easy to back up:

```bash
# Backup (Linux/macOS)
cp sqlite.db sqlite.db.backup.$(date +%Y%m%d)

# Backup (Windows PowerShell)
Copy-Item sqlite.db "sqlite.db.backup.$(Get-Date -Format yyyyMMdd)"

# Restore
Copy-Item sqlite.db.backup.YYYYMMDD sqlite.db
```

### Optional: PostgreSQL Migration

For high-concurrency production environments, consider migrating to PostgreSQL:

1. Install the PostgreSQL driver:
   ```bash
   npm install postgres
   ```
2. Update `.env`:
   ```env
   DATABASE_URL=postgresql://user:password@host:5432/dc-check
   ```
3. Update `drizzle.config.ts` to use the `pg` dialect
4. Regenerate and apply migrations:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

---

## 🔒 Security Considerations

- 🔑 **Change the default admin password** immediately after initial setup
- 🛡️ Use a strong, unique `SESSION_SECRET` (generate with `openssl rand -base64 32`)
- 🌐 **Enable HTTPS** in production (use a reverse proxy like Nginx or Caddy)
- 💾 **Regularly back up** your database file
- 📦 Keep all dependencies updated (`npm audit`)
- 🚫 Never commit `.env` to version control (it's already in `.gitignore`)

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is **private and proprietary**. All rights reserved.

---

## 💬 Support

For issues, questions, or feature requests, please contact the development team or open an issue on the repository.
]]>
