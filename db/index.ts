import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// === LAZY SINGLETON PATTERN ===
// Pool & Drizzle instance dibuat HANYA saat pertama kali `db` diakses (runtime),
// BUKAN saat module di-import (build time).

let _db: NodePgDatabase<typeof schema> | null = null;

function getDb(): NodePgDatabase<typeof schema> {
    if (!_db) {
        // Build DATABASE_URL dari komponen individual atau gunakan langsung
        let url = process.env.DATABASE_URL;

        if (!url) {
            const host = process.env.DB_HOST;
            const port = process.env.DB_PORT || '5432';
            const user = process.env.DB_USER;
            const password = process.env.DB_PASSWORD;
            const name = process.env.DB_NAME;

            if (host && user && password && name) {
                const encodedPassword = encodeURIComponent(password);
                url = `postgresql://${user}:${encodedPassword}@${host}:${port}/${name}`;
            } else {
                throw new Error(
                    'Database connection not configured! Set either:\n' +
                    '  - DATABASE_URL, OR\n' +
                    '  - DB_HOST, DB_USER, DB_PASSWORD, DB_NAME'
                );
            }
        }

        const pool = new Pool({ connectionString: url });
        _db = drizzle(pool, { schema });
    }
    return _db;
}

// Export sebagai getter agar setiap akses melewati lazy init
// Menggunakan defineProperty agar TypeScript tahu tipe-nya
export const db: NodePgDatabase<typeof schema> = new Proxy(
    {} as NodePgDatabase<typeof schema>,
    {
        get(_target, prop, receiver) {
            const instance = getDb();
            const value = (instance as any)[prop];
            if (typeof value === 'function') {
                return value.bind(instance);
            }
            return value;
        },
    }
);
