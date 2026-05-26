import archiver from "archiver";
import { existsSync } from "node:fs";
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
  const dump = await runShell("pg_dump", [
    "-h", options.database.host,
    "-p", options.database.port,
    "-U", options.database.user,
    "-d", options.database.name,
    "-Fc",
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
  archive.append(dump.stdout, { name: "dump.dump" });
  if (existsSync(options.uploadsDir)) {
    archive.directory(options.uploadsDir, "uploads");
  }
  await archive.finalize();
  await finished;
}
