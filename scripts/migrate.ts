#!/usr/bin/env tsx
/**
 * Database Migration Runner for PostgreSQL
 * 
 * This script runs all pending migrations in the drizzle/ folder.
 * Usage: npm run db:migrate
 */

import crypto from 'crypto';
import fs from 'fs';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
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
            return;
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
