/**
 * Disposable isolated PostgreSQL container for EPDR verification scripts.
 *
 * Never reads .env, never touches an existing database and never calls a
 * provider. Starts a local `postgres:15-alpine` container on a random loopback
 * port with a random password; the caller applies the handwritten journal,
 * runs its checks, and MUST call `cleanup()` in a finally block.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";

const IMAGE = "postgres:15-alpine";

function docker(args: string[], input?: string): string {
  return execFileSync("docker", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port ? resolve(port) : reject(new Error("no free port")));
    });
  });
}

async function waitReady(container: string, deadlineMs: number): Promise<void> {
  while (Date.now() < deadlineMs) {
    try {
      docker(["exec", container, "pg_isready", "-U", "postgres"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error("isolated PostgreSQL did not become ready");
}

export type IsolatedPostgres = {
  container: string;
  password: string;
  port: number;
  /** Apply every handwritten journal migration to the fresh database. */
  runMigrations(): Promise<void>;
  /** Fresh pg client for raw SQL checks. */
  createClient(): Client;
  /** Drizzle instance over a fresh client (for the migrator only). */
  createDrizzle(client: Client): NodePgDatabase<Record<string, never>>;
  /** Removes the container. Safe to call twice. */
  cleanup(): void;
};

/** Standard entry guards shared by both verification entries. */
export function verifyIsolatedInvocation(argv: string[]): number | null {
  if (!argv.includes("--run-isolated")) {
    console.error("Refusing to run: pass --run-isolated to start a disposable local PostgreSQL container.");
    return 2;
  }
  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    console.error("Refusing to run with DATABASE_URL/DB_HOST configured: this check must stay isolated.");
    return 2;
  }
  return null;
}

export async function startIsolatedPostgres(namePrefix: string): Promise<IsolatedPostgres> {
  const container = `${namePrefix}-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(18).toString("base64url");
  const port = await freePort();
  let removed = false;
  const instance: IsolatedPostgres = {
    container,
    password,
    port,
    async runMigrations() {
      const client = instance.createClient();
      try {
        await client.connect();
        const db = drizzle(client);
        await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    createClient() {
      return new Client({ host: "127.0.0.1", port, user: "postgres", password, database: "postgres" });
    },
    createDrizzle(client) {
      return drizzle(client) as NodePgDatabase<Record<string, never>>;
    },
    cleanup() {
      if (removed) return;
      removed = true;
      try {
        docker(["rm", "-f", container]);
      } catch {
        console.error(`WARNING: could not confirm removal of container ${container}`);
      }
    },
  };
  docker(["run", "-d", "--rm", "--name", container,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "-e", "POSTGRES_HOST_AUTH_METHOD=scram-sha-256",
    "-p", `127.0.0.1:${port}:5432`,
    IMAGE, "postgres", "-c", "fsync=off", "-c", "full_page_writes=off",
  ]);
  await waitReady(container, Date.now() + 60_000);
  return instance;
}
