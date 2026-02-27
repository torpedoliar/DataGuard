import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// === LAZY SINGLETON PATTERN ===
// Pool dibuat HANYA saat pertama kali `db` diakses (runtime),
// BUKAN saat module di-import (build time).
// Ini krusial karena Next.js standalone meng-evaluate module-level code saat BUILD,
// di mana environment variables belum tersedia.

let _pool: Pool | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

/**
 * Membangun DATABASE_URL dari komponen individual ATAU langsung dari env var.
 * Menggunakan komponen individual (DB_HOST, DB_USER, dll) lebih aman karena
 * menghindari masalah URL-encoding karakter spesial (!, @, #) di YAML/Shell.
 */
function buildDatabaseUrl(): string {
    // Prioritas 1: Gunakan DATABASE_URL jika sudah lengkap
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    // Prioritas 2: Compose dari komponen individual
    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || '5432';
    const user = process.env.DB_USER;
    const password = process.env.DB_PASSWORD;
    const name = process.env.DB_NAME;

    if (host && user && password && name) {
        // encodeURIComponent menangani karakter spesial (!, @, #) secara otomatis
        const encodedPassword = encodeURIComponent(password);
        return `postgresql://${user}:${encodedPassword}@${host}:${port}/${name}`;
    }

    throw new Error(
        'Database connection not configured! Set either:\n' +
        '  - DATABASE_URL environment variable, OR\n' +
        '  - DB_HOST, DB_USER, DB_PASSWORD, DB_NAME environment variables\n' +
        'Check docker-compose.yml or .env file.'
    );
}

function getPool() {
    if (!_pool) {
        const connectionString = buildDatabaseUrl();
        _pool = new Pool({ connectionString });
    }
    return _pool;
}

// Proxy: setiap kali `db` diakses, pastikan Pool sudah dibuat dengan env vars runtime
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
    get(_target, prop, receiver) {
        if (!_db) {
            _db = drizzle(getPool(), { schema });
        }
        return Reflect.get(_db, prop, receiver);
    },
});
