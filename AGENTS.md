# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 16 App Router project for data center audit management. Pages and route handlers live in `app/`; protected dashboard routes are under `app/(dashboard)/`. Server actions are in `actions/` and should keep mutations and query orchestration out of UI components. Reusable components live in `components/`, grouped by feature (`admin/`, `checklist/`, `grid/`, `report/`) with shared UI in `components/ui/`. Database code is in `db/`, generated Drizzle migrations in `drizzle/`, utilities in `lib/`, CLI helpers in `scripts/`, and assets/uploads in `public/`.

## Build, Test, and Development Commands

- `npm run dev`: start the local Next.js development server.
- `npm run build`: create a production build and catch build errors.
- `npm run start`: run the built production server.
- `npm run lint`: run ESLint with Next core web vitals and TypeScript rules.
- `npm run db:generate`: generate Drizzle migration SQL from `db/schema.ts`.
- `npm run db:migrate`: apply migrations via `scripts/migrate.ts`.
- `npm run db:studio`: open Drizzle Studio.
- `npm run seed`, `npm run seed:users`, `npm run reset:devices`: manage development data.

## Coding Style & Naming Conventions

Use TypeScript with `strict` mode and the `@/*` alias from `tsconfig.json`. Follow the style of the file you edit: spaces for indentation, React components in PascalCase, functions and variables in camelCase, and route folders in lowercase/kebab-case. Keep server-only logic in `actions/`, `lib/`, or `db/`; add `"use client"` only when browser APIs, state, or effects are required. Run `npm run lint` before handoff.

## Testing Guidelines

No automated test framework is currently configured. Validate changes with `npm run lint` and `npm run build`, then manually exercise affected workflows such as login, site switching, checklist entry, rack layout, report export, or admin CRUD. If adding tests, prefer colocated `*.test.ts` or `*.test.tsx` files and document the command in `package.json`.

## Commit & Pull Request Guidelines

Recent history uses conventional-style subjects such as `feat: ...`, `fix: ...`, `fix(deploy): ...`, and `chore: ...`. Keep commit titles imperative and specific. Pull requests should include a short summary, validation steps, linked issue or task, screenshots for UI changes, and notes for migrations, seed data, or environment changes.

## Security & Configuration Tips

Do not commit `.env`, uploaded private files, database dumps, or production secrets. Configure the database with `DATABASE_URL` or `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`; Drizzle currently targets PostgreSQL. Keep `SESSION_SECRET` at least 32 characters and rotate default credentials after seeding.
