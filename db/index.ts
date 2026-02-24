import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';

const DB_FILE = process.env.DB_FILE_NAME || 'sqlite.db';

const sqlite = new Database(DB_FILE);
export const db = drizzle(sqlite, { schema });
