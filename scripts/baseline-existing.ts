#!/usr/bin/env tsx
/**
 * ONE-TIME push -> migrate cutover bridge.
 *
 * Production historically kept its schema in sync with `drizzle-kit push`,
 * which applies schema changes physically but never records them in the
 * `drizzle.__drizzle_migrations` tracking table. Switching the deploy to
 * `drizzle migrate` therefore makes Drizzle believe NO migrations have run,
 * so it would try to replay 0000..N from scratch and fail with
 * "type/relation already exists".
 *
 * This script seeds the tracking table with every migration in the journal
 * EXCEPT the most recent one, marking the current physical state (everything
 * a prior `push` already applied) as done. The newest migration is left
 * unrecorded so `migrate` applies it normally.
 *
 * Run ONCE on the server during the cutover:
 *   docker exec dccheck_app npx tsx scripts/baseline-existing.ts
 *
 * It is idempotent: migrations whose hash is already present are skipped, so
 * re-running is safe. After the first successful migrate-based deploy this
 * script is no longer needed.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import { buildDatabaseUrl, redactDatabaseUrl } from '../lib/database-url';

dotenv.config();

const DATABASE_URL = buildDatabaseUrl();
const migrationsFolder = path.join(__dirname, '../drizzle');
const migrationsSchema = 'drizzle';
const migrationsTable = '__drizzle_migrations';

interface JournalEntry {
    tag: string;
    when: number;
}

async function main() {
    console.log(`🔧 Baseline cutover on database: ${redactDatabaseUrl(DATABASE_URL)}`);

    const journalPath = path.join(migrationsFolder, 'meta/_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
        entries: JournalEntry[];
    };
    const entries = [...journal.entries].sort((a, b) => a.when - b.when);

    if (entries.length === 0) {
        console.log('No migrations in journal; nothing to baseline.');
        return;
    }

    // Mark everything EXCEPT the newest migration as already applied.
    const toBaseline = entries.slice(0, -1);
    const newest = entries[entries.length - 1];
    console.log(`ℹ️  Newest migration "${newest.tag}" left unrecorded (migrate will apply it).`);

    const pool = new Pool({ connectionString: DATABASE_URL });
    const client = await pool.connect();
    try {
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${migrationsSchema}"`);
        await client.query(
            `CREATE TABLE IF NOT EXISTS "${migrationsSchema}"."${migrationsTable}" (
                id SERIAL PRIMARY KEY,
                hash text NOT NULL,
                created_at bigint
            )`,
        );

        const existing = await client.query<{ hash: string }>(
            `SELECT hash FROM "${migrationsSchema}"."${migrationsTable}"`,
        );
        const existingHashes = new Set(existing.rows.map((r) => r.hash));

        let stamped = 0;
        for (const entry of toBaseline) {
            const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
            const sql = fs.readFileSync(sqlPath, 'utf8');
            const hash = crypto.createHash('sha256').update(sql).digest('hex');

            if (existingHashes.has(hash)) {
                console.log(`   = ${entry.tag} already recorded; skipping.`);
                continue;
            }

            await client.query(
                `INSERT INTO "${migrationsSchema}"."${migrationsTable}" (hash, created_at)
                 VALUES ($1, $2)`,
                [hash, entry.when],
            );
            console.log(`   + ${entry.tag} marked as applied.`);
            stamped += 1;
        }

        console.log(`✅ Baseline complete. ${stamped} migration(s) recorded as already applied.`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((error) => {
    console.error('❌ Baseline failed:');
    console.error(error);
    process.exit(1);
});
