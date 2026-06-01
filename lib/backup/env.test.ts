import { describe, expect, it } from "vitest";
import { resolveBackupEnv } from "./env";

describe("resolveBackupEnv", () => {
  it("reads database connection and uploads path from env", () => {
    const env = resolveBackupEnv({
      DB_HOST: "db",
      DB_PORT: "5432",
      DB_USER: "administrator",
      DB_PASSWORD: "secret",
      DB_NAME: "dccheck",
    });
    expect(env.database).toEqual({
      host: "db",
      port: "5432",
      user: "administrator",
      password: "secret",
      name: "dccheck",
    });
    expect(env.uploadsDir).toBe("/app/public/uploads");
    expect(env.backupLockPath).toBe("/tmp/.dccheck-backup-lock");
    expect(env.restoreLockPath).toBe("/tmp/.dccheck-restore-lock");
  });

  it("throws when a required value is missing", () => {
    expect(() => resolveBackupEnv({ DB_HOST: "", DB_PORT: "5432", DB_USER: "u", DB_PASSWORD: "p", DB_NAME: "d" })).toThrow(/DB_HOST/);
  });

  it("respects overrides for uploads and lock paths", () => {
    const env = resolveBackupEnv({
      DB_HOST: "db",
      DB_PORT: "5432",
      DB_USER: "u",
      DB_PASSWORD: "p",
      DB_NAME: "d",
      UPLOADS_DIR: "/data/uploads",
      BACKUP_LOCK_PATH: "/tmp/backup.lock",
      RESTORE_LOCK_PATH: "/tmp/restore.lock",
    });
    expect(env.uploadsDir).toBe("/data/uploads");
    expect(env.backupLockPath).toBe("/tmp/backup.lock");
    expect(env.restoreLockPath).toBe("/tmp/restore.lock");
  });
});
