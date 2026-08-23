import { z } from "zod";
import { DEV_SESSION_SECRET_FALLBACK } from "./env-dev";

// Re-exported so existing imports of `devSessionSecretFallback` from this
// module keep working after the constant moved to `lib/env-dev.ts`.
export const devSessionSecretFallback = DEV_SESSION_SECRET_FALLBACK;

// Dev-only fallback for AI_KEY_ENCRYPTION_SECRET. In production getEnv()
// still throws when AI_KEY_ENCRYPTION_SECRET is missing.
export const DEV_AI_KEY_ENCRYPTION_FALLBACK = "dc-check" + "-ai-key-" + "encryption-dev-fallback-32-chars-aaa";

const envSchema = z.object({
  // Authentication — SESSION_SECRET has no default; in production it must be set
  // explicitly. In development a known dev default is allowed so local `npm run dev`
  // works out of the box, but `getEnv()` will still fail in production if it is
  // missing or matches the dev default.
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters long")
    .default(() => {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "SESSION_SECRET is required in production (must be at least 32 characters; " +
            "the development default is not allowed). " +
            "Generate one with: openssl rand -base64 32",
        );
      }
      return DEV_SESSION_SECRET_FALLBACK;
    }),

  // File Upload
  UPLOAD_DIR: z.string().default("./public/uploads"),
  MAX_FILE_SIZE: z.coerce.number().default(5242880),

  // PostgreSQL — DATABASE_URL opsional, bisa di-compose dari DB_HOST/DB_USER/DB_PASSWORD/DB_NAME
  DATABASE_URL: z.string().optional(),
  // DB_* components used by buildDatabaseUrl when DATABASE_URL is absent.
  // Optional so a partial environment (e.g. a bare app container that only
  // passes DATABASE_URL) does not fail validation; the dev defaults in
  // lib/database-url.ts remain the fallback for unset fields.
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),

  // Telegram bot. Optional: a missing token must not fail a build; the bot
  // falls back to the DB-stored token (lib/telegram.ts) or reports
  // "Telegram bot token missing" when neither is configured.
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Operator-controlled base URL for alert deep links. Optional: when
  // absent lib/notification-url.ts falls back to the stored login host.
  APP_URL: z.string().optional(),

  // network-doc sync (lib/network-doc.ts). Optional: when URL or API key are
  // absent the sync reports "not configured" and skips — it must never crash
  // the scheduled worker (restart: always). These are the GLOBAL default; each
  // site can override them per-row from Settings › Network Docs.
  NETWORK_DOC_URL: z.string().optional(),
  NETWORK_DOC_API_KEY: z.string().optional(),
  NETWORK_DOC_SYNC_INTERVAL_MS: z.string().optional(),

  // Explicit cookie security override (lib/session.ts). Optional — secure
  // cookies are also forced when APP_URL is https or the request arrived
  // behind a TLS proxy (X-Forwarded-Proto: https).
  SECURE_COOKIES: z.string().optional(),

  // SIEM AI provider overrides (actions/siem-ai.ts, lib/siem/ai-queue.ts)
  SIEM_AI_ENDPOINT_URL: z.string().optional(),
  SIEM_AI_API_KEY: z.string().optional(),
  SIEM_AI_DEFAULT_MODEL: z.string().optional(),
  SIEM_AI_MODEL_OPUS: z.string().optional(),
  SIEM_AI_MODEL_SONNET: z.string().optional(),
  SIEM_AI_MODEL_HAIKU: z.string().optional(),

  // SMTP used by the SIEM email alert channel (lib/siem/alerts.ts)
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Optional: S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),

  // AI key encryption (N49). Encrypts siemSettings.aiApiKey at rest with
  // AES-256-GCM. Required in production so a DB dump does not leak provider
  // API keys. In dev/test a known static fallback is allowed so local
  // `npm run dev` and the test suite work without a generated secret.
  AI_KEY_ENCRYPTION_SECRET: z
    .string()
    .min(32, "AI_KEY_ENCRYPTION_SECRET must be at least 32 characters")
    .optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig | null = null;
// Fingerprint of exactly the variables envSchema validates, captured from the
// process.env snapshot that produced `config`. When the env changes (tests use
// vi.stubEnv/assignment to vary values per test), getEnv() re-parses instead of
// returning the stale cached snapshot; the steady state stays cached+validated.
let configEnvelope: string | null = null;

function envEnvelope(source: NodeJS.ProcessEnv): string | null {
  const keys = Object.keys(envSchema.shape).sort();
  return JSON.stringify(keys.map((key) => [key, source[key] ?? ""]));
}

function validateProduction(config: EnvConfig): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const secret = config.SESSION_SECRET;
  if (!secret || secret.length < 32 || secret === DEV_SESSION_SECRET_FALLBACK) {
    throw new Error(
      "Environment variable validation failed:\n" +
        "SESSION_SECRET: SESSION_SECRET is required in production and must be at least 32 characters; " +
        "the development default is not allowed. " +
        "Generate one with: openssl rand -base64 32",
    );
  }

  // N49: refuse to boot prod without an AI key encryption secret. The dev
  // fallback constant is only ever allowed in non-prod NODE_ENVs.
  const aiKeySecret = config.AI_KEY_ENCRYPTION_SECRET;
  if (!aiKeySecret || aiKeySecret === DEV_AI_KEY_ENCRYPTION_FALLBACK) {
    throw new Error(
      "Environment variable validation failed:\n" +
        "AI_KEY_ENCRYPTION_SECRET: required in production so siemSettings.aiApiKey " +
        "can be encrypted at rest. Generate one with: openssl rand -base64 32",
    );
  }
}

export function getEnv() {
  const envelope = envEnvelope(process.env);
  if (config && envelope !== null && envelope === configEnvelope) {
    return config;
  }

  try {
    const parsed = envSchema.parse(process.env);
    validateProduction(parsed);
    config = parsed;
    configEnvelope = envelope;
    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.issues.map((err) => {
        const path = err.path.join(".");
        return `${path || "root"}: ${err.message}`;
      });
      throw new Error(`Environment variable validation failed:\n${errors.join("\n")}`);
    }
    throw error;
  }
}

export function getEnvValue(key: keyof EnvConfig, defaultValue?: string): string {
  const env = getEnv();
  const value = env[key];
  if (value === undefined && defaultValue !== undefined) {
    return defaultValue;
  }
  return String(value ?? "");
}
