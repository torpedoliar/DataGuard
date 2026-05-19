import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { buildDatabaseUrl } from '../lib/database-url';

// === LAZY SINGLETON PATTERN ===
// Pool & Drizzle instance dibuat HANYA saat pertama kali `db` diakses (runtime),
// BUKAN saat module di-import (build time).

let _db: NodePgDatabase<typeof schema> | null = null;

function getDb(): NodePgDatabase<typeof schema> {
    if (!_db) {
        const url = buildDatabaseUrl(process.env, { requireCompleteConfig: true });

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
        get(_target, prop) {
            const instance = getDb();
            const value = Reflect.get(instance, prop);
            if (typeof value === 'function') {
                return value.bind(instance);
            }
            return value;
        },
    }
);
