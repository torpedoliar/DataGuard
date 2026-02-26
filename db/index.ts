import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Create a Postgres pool connection
// Di container, DATABASE_URL di-inject oleh docker-compose environment
// Di lokal, DATABASE_URL dibaca dari .env oleh Next.js secara otomatis
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/dccheck',
});

// Create drizzle instance with pg pool
export const db = drizzle(pool, { schema });
