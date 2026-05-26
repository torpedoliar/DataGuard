import type { DatabaseTarget } from "./build-archive";

export type BackupEnv = {
  database: DatabaseTarget;
  uploadsDir: string;
  backupLockPath: string;
  restoreLockPath: string;
};

function readRequired(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required for backup operations`);
  return value;
}

export function resolveBackupEnv(env: Record<string, string | undefined> = process.env): BackupEnv {
  return {
    database: {
      host: readRequired(env, "DB_HOST"),
      port: readRequired(env, "DB_PORT"),
      user: readRequired(env, "DB_USER"),
      password: readRequired(env, "DB_PASSWORD"),
      name: readRequired(env, "DB_NAME"),
    },
    uploadsDir: env.UPLOADS_DIR ?? "/app/public/uploads",
    backupLockPath: env.BACKUP_LOCK_PATH ?? "/tmp/.dccheck-backup-lock",
    restoreLockPath: env.RESTORE_LOCK_PATH ?? "/tmp/.dccheck-restore-lock",
  };
}
