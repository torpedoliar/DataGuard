import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
import { buildDatabaseUrl } from "./lib/database-url";

dotenv.config();

export default defineConfig({
    schema: "./db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: buildDatabaseUrl(),
    },
});
