import { getEnv } from "./env";

type EnvLike = Record<string, string | undefined>;

type DatabaseUrlOptions = {
  requireCompleteConfig?: boolean;
};

export function buildDatabaseUrl(env: EnvLike = process.env, options: DatabaseUrlOptions = {}): string {
  // Route DB_* through the same zod-validated env schema as everything else
  // when the caller passes the real process.env. Tests that pass literal
  // objects stay bypassed (their values are already explicit).
  const envSource: EnvLike = env === process.env
    ? {
        ...env,
        DB_HOST: getEnv().DB_HOST,
        DB_PORT: getEnv().DB_PORT,
        DB_USER: getEnv().DB_USER,
        DB_PASSWORD: getEnv().DB_PASSWORD,
        DB_NAME: getEnv().DB_NAME,
      }
    : env;

  if (envSource.DATABASE_URL) return envSource.DATABASE_URL;

  if (options.requireCompleteConfig && (!envSource.DB_HOST || !envSource.DB_USER || !envSource.DB_PASSWORD || !envSource.DB_NAME)) {
    throw new Error(
      "Database connection not configured! Set either DATABASE_URL or DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME.",
    );
  }

  const host = envSource.DB_HOST || "localhost";
  const port = envSource.DB_PORT || "5432";
  const user = envSource.DB_USER || "postgres";
  const password = envSource.DB_PASSWORD || "postgres";
  const name = envSource.DB_NAME || "dccheck";

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
  }
}
