#!/usr/bin/env tsx
/**
 * Database Migration Runner for PostgreSQL
 *
 * This script runs all pending migrations in the drizzle/ folder.
 * Usage: npm run db:migrate
 *
 * Ordering is by journal idx, NOT by `when`: drizzle's migrator iterates
 * drizzle/meta/_journal.json entries in array order (idx order) and the `when`
 * field is only bookkeeping — it is stored as created_at in
 * __drizzle_migrations and used solely to decide whether an entry is newer
 * than the last applied migration. Keep `when` strictly increasing with idx
 * (see finding #74) but never rely on it for application order.
 */

import crypto from 'crypto';
import fs from 'fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import path from 'path';
import dotenv from 'dotenv';
import { buildDatabaseUrl, redactDatabaseUrl } from '../lib/database-url';

dotenv.config();

const DATABASE_URL = buildDatabaseUrl();

console.log(`📦 Running migrations on database: ${redactDatabaseUrl(DATABASE_URL)}`);

// Create database connection pool
const pool = new Pool({
    connectionString: DATABASE_URL,
});

const db = drizzle(pool);
const migrationsFolder = path.join(__dirname, '../drizzle');
const migrationsSchema = 'drizzle';
const migrationsTable = '__drizzle_migrations';
const baselineTag = '0000_adorable_jackal';
const baselineTables = [
    'audit_logs',
    'brands',
    'categories',
    'checklist_entries',
    'checklist_items',
    'devices',
    'global_settings',
    'locations',
    'network_ports',
    'racks',
    'sites',
    'user_sites',
    'users',
    'vlans',
];

/**
 * The `__drizzle_migrations.id` column is SERIAL but rows are sometimes
 * inserted with explicit ids (baseline seeding), which desyncs the sequence.
 * Realign it to max(id) so drizzle's `insert into ... ("hash","created_at")`
 * (which omits the id) can't collide with an existing row.
 */
async function fixMigrationSequence(client: PoolClient, schema: string, table: string) {
    await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1))
         FROM "${schema}"."${table}"`,
        [`${schema}.${table}`],
    );
}

async function baselineExistingSchema() {
    const journalPath = path.join(migrationsFolder, 'meta/_journal.json');
    const migrationPath = path.join(migrationsFolder, `${baselineTag}.sql`);
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
        entries: Array<{ tag: string; when: number }>;
    };
    const baselineEntry = journal.entries.find((entry) => entry.tag === baselineTag);
    if (!baselineEntry) {
        throw new Error(`Baseline migration ${baselineTag} not found in Drizzle journal.`);
    }

    const client = await pool.connect();
    try {
        const migrationState = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM information_schema.tables
             WHERE table_schema = $1 AND table_name = $2`,
            [migrationsSchema, migrationsTable],
        );
        if (Number(migrationState.rows[0]?.count ?? 0) > 0) {
            const latestMigration = await client.query<{ created_at: string }>(
                `SELECT created_at::text AS created_at
                 FROM "${migrationsSchema}"."${migrationsTable}"
                 ORDER BY created_at DESC
                 LIMIT 1`,
            );
            if (Number(latestMigration.rows[0]?.created_at ?? 0) >= baselineEntry.when) {
                await fixMigrationSequence(client, migrationsSchema, migrationsTable);
                return;
            }
        }

        const existingTables = await client.query<{ table_name: string }>(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
            [baselineTables],
        );
        if (existingTables.rowCount !== baselineTables.length) {
            return;
        }

        const migrationSql = fs.readFileSync(migrationPath, 'utf8');
        const hash = crypto.createHash('sha256').update(migrationSql).digest('hex');

        await client.query(`CREATE SCHEMA IF NOT EXISTS "${migrationsSchema}"`);
        await client.query(
            `CREATE TABLE IF NOT EXISTS "${migrationsSchema}"."${migrationsTable}" (
                id SERIAL PRIMARY KEY,
                hash text NOT NULL,
                created_at bigint
            )`,
        );
        await client.query(
            `INSERT INTO "${migrationsSchema}"."${migrationsTable}" (hash, created_at)
             VALUES ($1, $2)`,
            [hash, baselineEntry.when],
        );
        console.log(`ℹ️  Existing schema detected; marked ${baselineTag} as already applied.`);
    } finally {
        client.release();
    }
}

async function main() {
    console.log('🔄 Starting migration process...');
    const start = Date.now();

    try {
        await baselineExistingSchema();

        const seqClient = await pool.connect();
        try {
            await fixMigrationSequence(seqClient, migrationsSchema, migrationsTable);
        } finally {
            seqClient.release();
        }

        await migrate(db, { migrationsFolder, migrationsSchema, migrationsTable });

        const end = Date.now();
        console.log(`✅ Migrations completed successfully in ${end - start}ms`);
    } catch (error) {
        console.error('❌ Failed to run migrations:');
        console.error(error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
