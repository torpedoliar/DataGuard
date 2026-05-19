type EnvLike = Record<string, string | undefined>;

type DatabaseUrlOptions = {
  requireCompleteConfig?: boolean;
};

export function buildDatabaseUrl(env: EnvLike = process.env, options: DatabaseUrlOptions = {}): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  if (options.requireCompleteConfig && (!env.DB_HOST || !env.DB_USER || !env.DB_PASSWORD || !env.DB_NAME)) {
    throw new Error(
      "Database connection not configured! Set either DATABASE_URL or DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME.",
    );
  }

  const host = env.DB_HOST || "localhost";
  const port = env.DB_PORT || "5432";
  const user = env.DB_USER || "postgres";
  const password = env.DB_PASSWORD || "postgres";
  const name = env.DB_NAME || "dccheck";

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
