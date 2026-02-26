#!/usr/bin/env tsx
/**
 * Database Migration Runner for PostgreSQL
 * 
 * This script runs all pending migrations in the drizzle/ folder.
 * Usage: npm run db:migrate
 */

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dccheck';

console.log(`📦 Running migrations on database: ${DATABASE_URL}`);

// Create database connection pool
const pool = new Pool({
    connectionString: DATABASE_URL,
});

const db = drizzle(pool);

async function main() {
    console.log('🔄 Starting migration process...');
    const start = Date.now();

    try {
        await migrate(db, { migrationsFolder: path.join(__dirname, '../drizzle') });

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
