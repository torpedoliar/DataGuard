# DC-Check - Data Center Audit Management System

A comprehensive data center equipment audit and checklist management system built with Next.js 16, Drizzle ORM, and SQLite.

## Features

- 🔐 **Authentication** - JWT-based sessions with role-based access control (Admin/Staff)
- 📋 **Daily Checklists** - Perform equipment inspections with photo documentation
- 📊 **Dashboard** - Real-time completion statistics and activity feed
- 📈 **Analytics** - Compliance trends, failure analysis, and KPI tracking
- 📅 **Audit Grid** - 7-day matrix view of equipment status history
- 📤 **Excel Export** - Generate compliance reports in Excel format
- 🔧 **Admin Panel** - Manage devices, categories, and users

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | Next.js 16.1.6 (App Router) |
| Frontend | React 19.2.3, TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite (better-sqlite3) |
| ORM | Drizzle ORM |
| Auth | JWT (jose) + bcryptjs |
| Validation | Zod |
| Export | XLSX |

## Getting Started

### Prerequisites

- Node.js 20+
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd dc-check
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Copy the example env file
   cp .env.example .env
   
   # Edit .env and set your SESSION_SECRET (min 32 characters)
   # You can generate one with: openssl rand -base64 32
   ```

4. **Set up the database**
   ```bash
   # Generate migrations
   npm run db:generate
   
   # Apply migrations
   npm run db:migrate
   
   # Seed initial data (creates admin user and sample data)
   npm run seed
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open [http://localhost:3000](http://localhost:3000)**

### Default Credentials

```
Username: admin
Password: password
```

⚠️ **Change the default password immediately!**

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push schema changes to database |
| `npm run db:generate` | Generate migration files |
| `npm run db:migrate` | Apply migrations to database |
| `npm run db:studio` | Open Drizzle Studio (database GUI) |
| `npm run seed` | Seed database with initial data |

## Database Schema

```
users
├── id (PK)
├── username (unique)
├── role (admin/staff)
├── password_hash
└── created_at

categories
├── id (PK)
└── name

devices
├── id (PK)
├── category_id (FK → categories)
├── name
└── location

checklist_entries
├── id (PK)
├── user_id (FK → users)
├── check_date
├── check_time
├── shift (Pagi/Siang/Malam)
└── created_at

checklist_items
├── id (PK)
├── entry_id (FK → checklist_entries)
├── device_id (FK → devices)
├── status (OK/Warning/Error)
├── remarks
└── photo_path
```

## Project Structure

```
dc-check/
├── app/                    # Next.js App Router pages
│   ├── (dashboard)/        # Protected dashboard routes
│   ├── audit/              # Audit form pages
│   ├── login/              # Login page
│   └── api/                # API routes
├── actions/                # Server actions
├── components/             # React components
│   ├── admin/              # Admin panel components
│   ├── checklist/          # Checklist components
│   ├── report/             # Report components
│   └── ui/                 # Shared UI components
├── db/                     # Database configuration
│   ├── schema.ts           # Drizzle schema definitions
│   └── index.ts            # Database connection
├── drizzle/                # Generated migrations
├── lib/                    # Utility libraries
├── scripts/                # Utility scripts
└── public/uploads/         # Uploaded files
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_FILE_NAME` | No | sqlite.db | SQLite database file path |
| `SESSION_SECRET` | Yes | - | JWT secret (min 32 chars) |
| `UPLOAD_DIR` | No | ./public/uploads | File upload directory |
| `MAX_FILE_SIZE` | No | 5242880 | Max upload size in bytes (5MB) |

## Production Deployment

### Database Migration in Production

For production, consider migrating to PostgreSQL:

1. Install PostgreSQL dependencies:
   ```bash
   npm install postgres
   ```

2. Update `.env`:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/dc-check
   ```

3. Update `drizzle.config.ts` for PostgreSQL dialect

4. Run migrations:
   ```bash
   npm run db:generate
   npm run db:migrate
   ```

### Backup & Restore

Database files are located in `sqlite.db`. Regular backups recommended:

```bash
# Backup
cp sqlite.db sqlite.db.backup.$(date +%Y%m%d)

# Restore
cp sqlite.db.backup.YYYYMMDD sqlite.db
```

## Security Considerations

- Change the default admin password immediately
- Use a strong, unique `SESSION_SECRET` in production
- Enable HTTPS in production
- Regularly backup your database
- Keep dependencies updated

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is private and proprietary.

## Support

For issues and questions, please contact the development team.
