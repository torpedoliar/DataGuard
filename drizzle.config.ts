import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

/**
 * Build DATABASE_URL dari komponen individual ATAU gunakan langsung.
 * Sama logikanya dengan db/index.ts — menghindari masalah URL encoding.
 */
function getDatabaseUrl(): string {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    const host = process.env.DB_HOST || "localhost";
    const port = process.env.DB_PORT || "5432";
    const user = process.env.DB_USER || "postgres";
    const password = process.env.DB_PASSWORD || "postgres";
    const name = process.env.DB_NAME || "dccheck";

    const encodedPassword = encodeURIComponent(password);
    return `postgresql://${user}:${encodedPassword}@${host}:${port}/${name}`;
}

export default defineConfig({
    schema: "./db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: getDatabaseUrl(),
    },
});
