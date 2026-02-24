#!/usr/bin/env tsx
/**
 * Database Migration Runner
 * 
 * This script runs all pending migrations in the drizzle/ folder.
 * Usage: npm run db:migrate
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_FILE = process.env.DB_FILE_NAME || 'sqlite.db';

console.log(`📦 Running migrations on database: ${DB_FILE}`);

// Ensure the database directory exists
const dbDir = path.dirname(DB_FILE);
if (dbDir && dbDir !== '.' && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`📁 Created database directory: ${dbDir}`);
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`📁 Created uploads directory: ${uploadsDir}`);
}

// Create database connection
const sqlite = new Database(DB_FILE);

// Read migration files
const migrationsFolder = path.join(__dirname, '..', 'drizzle');
const migrationFiles = fs
    .readdirSync(migrationsFolder)
    .filter(file => file.endsWith('.sql'))
    .sort();

console.log(`📂 Found ${migrationFiles.length} migration file(s)`);

// Create migrations table if not exists
sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
    )
`);

// Get already applied migrations
const appliedMigrations = sqlite
    .prepare('SELECT hash FROM __drizzle_migrations')
    .all() as { hash: string }[];

const appliedHashes = new Set(appliedMigrations.map(m => m.hash));

// Apply pending migrations
let appliedCount = 0;
for (const file of migrationFiles) {
    const filePath = path.join(migrationsFolder, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Create a simple hash from file content
    const hash = `${file}-${content.length}`;

    if (appliedHashes.has(hash)) {
        console.log(`⏭️  Skipping: ${file}`);
        continue;
    }

    console.log(`🔄 Applying: ${file}`);

    try {
        // Split by statement-breakpoint and execute each
        const statements = content.split('--> statement-breakpoint');

        for (const statement of statements) {
            const sql = statement.trim();
            if (sql && !sql.startsWith('--')) {
                try {
                    sqlite.exec(sql);
                } catch (err: unknown) {
                    const error = err as Error;
                    if (error.message?.includes('already exists') ||
                        error.message?.includes('duplicate')) {
                        console.log(`   ⚠️  Already exists, skipping`);
                    } else {
                        throw err;
                    }
                }
            }
        }

        // Record migration
        sqlite.prepare('INSERT INTO __drizzle_migrations (hash) VALUES (?)').run(hash);
        appliedCount++;
        console.log(`✅ Applied: ${file}`);
    } catch (err: unknown) {
        const error = err as Error;
        console.error(`❌ Failed to apply ${file}:`, error.message);
        sqlite.close();
        process.exit(1);
    }
}

console.log(`\n✅ ${appliedCount} migration(s) applied successfully!`);
sqlite.close();
