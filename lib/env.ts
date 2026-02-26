import { z } from "zod";

const envSchema = z.object({
  // Authentication
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters long").default("dc-check-development-secret-key-change-in-production"),

  // File Upload
  UPLOAD_DIR: z.string().default("./public/uploads"),
  MAX_FILE_SIZE: z.coerce.number().default(5242880),

  // PostgreSQL
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/dccheck"),

  // Optional: S3
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let config: EnvConfig | null = null;

export function getEnv() {
  if (config) {
    return config;
  }

  try {
    config = envSchema.parse(process.env);
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
