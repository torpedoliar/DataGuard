# Contributing to DataGuard

Thanks for your interest! This guide covers local dev setup, code style, and the PR process.

## Local development

1. Fork the repository and clone your fork.
2. Install dependencies: `npm install`.
3. Copy `.env.example.production` to `.env` and fill in the values (PostgreSQL connection, `SESSION_SECRET` of at least 32 characters).
4. Apply migrations and seed: `npm run db:migrate`, then `npm run seed:users` (or `npm run seed` for the full dataset).
5. Start the dev server: `npm run dev`. The SIEM workers (`npm run siem:parser`, `npm run siem:rules`, `npm run siem:alerts`, `npm run siem:retention`, `npm run siem:ai`) are optional and can run alongside the app.
6. For containerized dev, use `docker compose up` from the repo root.

## Code style
- TypeScript strict mode
- ESLint + Prettier (run `npm run lint` before commit)
- Conventional commit messages (feat:, fix:, chore:, etc.)
- Pure functions where possible

## Testing
- `npm test` — vitest
- New features need tests in `*.test.ts` colocated with source
- Run `npm run build` before opening PR

## Pull request process
1. Fork the repo
2. Create a feature branch from `main`
3. Make your changes with tests
4. Run `npm run check` — must pass
5. Open a PR using the template
6. Address review feedback

## Architecture
See [AGENTS.md](AGENTS.md) and [GEMINI.md](GEMINI.md) for the project conventions.

## Communication
- Issues: <github issues url>
- Discussions: <github discussions url>
