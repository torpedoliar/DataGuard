import archiver from "archiver";
import { createReadStream, createWriteStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import type { RunShellResult } from "./run-shell";
import { runShell as defaultRunShell } from "./run-shell";

export type DatabaseTarget = {
  host: string;
  port: string;
  user: string;
  password: string;
  name: string;
};

export type BuildBackupOptions = {
  output: Writable;
  uploadsDir: string;
  database: DatabaseTarget;
  runShell?: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<RunShellResult>;
};

export async function buildBackupArchive(options: BuildBackupOptions): Promise<void> {
  const runShell = options.runShell ?? defaultRunShell;
  const directory = mkdtempSync(path.join(tmpdir(), "dccheck-backup-"));
  const dumpPath = path.join(directory, "dump.dump");

  try {
    const dump = await runShell("pg_dump", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      "-d", options.database.name,
      "-Fc",
      "-f", dumpPath,
    ], { env: { ...process.env, PGPASSWORD: options.database.password } });

    if (dump.code !== 0) {
      throw new Error(`pg_dump failed: ${dump.stderr.toString().trim()}`);
    }

    const archive = archiver("zip", { zlib: { level: 6 } });
    const finished = new Promise<void>((resolve, reject) => {
      archive.on("error", reject);
      options.output.on("error", reject);
      options.output.on("close", resolve);
      options.output.on("finish", resolve);
    });
    archive.pipe(options.output);
    archive.append(createReadStream(dumpPath), { name: "dump.dump" });
    if (existsSync(options.uploadsDir)) {
      archive.directory(options.uploadsDir, "uploads");
    }
    await archive.finalize();
    await finished;
  }
  finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export type WriteBackupOptions = {
  filePath: string;
  uploadsDir: string;
  database: DatabaseTarget;
  runShell?: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => Promise<RunShellResult>;
};

export type WriteBackupResult = {
  filePath: string;
  bytes: number;
};

/**
 * Build a backup archive and write it to a local file. Returns the file size
 * once the write is fully flushed to disk. Reuses `buildBackupArchive`
 * internally by piping the archive into a file write stream.
 */
export async function writeBackupToFile(options: WriteBackupOptions): Promise<WriteBackupResult> {
  const output = createWriteStream(options.filePath);
  await buildBackupArchive({
    output,
    uploadsDir: options.uploadsDir,
    database: options.database,
    runShell: options.runShell,
  });
  const stats = statSync(options.filePath);
  return { filePath: options.filePath, bytes: stats.size };
}
