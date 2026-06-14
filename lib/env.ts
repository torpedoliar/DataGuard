import { z } from "zod";
import { DEV_SESSION_SECRET_FALLBACK } from "./env-dev";

// Re-exported so existing imports of `devSessionSecretFallback` from this
// module keep working after the constant moved to `lib/env-dev.ts`.
export const devSessionSecretFallback = DEV_SESSION_SECRET_FALLBACK;

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

  // Optional: S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig | null = null;

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
}

export function getEnv() {
  if (config) {
    return config;
  }

  try {
    const parsed = envSchema.parse(process.env);
    validateProduction(parsed);
    config = parsed;
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
