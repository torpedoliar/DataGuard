import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import unzipper from "unzipper";
import type { DatabaseTarget } from "./build-archive";
import type { RunShellResult } from "./run-shell";
import { runShell as defaultRunShell } from "./run-shell";

export type RestoreMode = "wipe" | "append";

export type RestoreOptions = {
  archive: Buffer;
  uploadsDir: string;
  mode: RestoreMode;
  database: DatabaseTarget;
  runShell?: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv; input?: Buffer | string }) => Promise<RunShellResult>;
};

export type RestoreResult = {
  mode: RestoreMode;
  warnings: string[];
};

function safeExtractPath(directory: string, entryPath: string): string {
  const target = path.resolve(directory, entryPath);
  const root = path.resolve(directory);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Archive entry is outside restore directory: ${entryPath}`);
  }
  return target;
}

async function extractArchive(archive: Buffer): Promise<string> {
  const directory = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
  try {
    const zip = await unzipper.Open.buffer(archive);
    for (const file of zip.files) {
      const target = safeExtractPath(directory, file.path);
    if (file.type === "Directory") {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, await file.buffer());
    }
    return directory;
  }
  catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function copyDir(from: string, to: string) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(toPath, { recursive: true });
      copyDir(fromPath, toPath);
    } else {
      copyFileSync(fromPath, toPath);
    }
  }
}

function copyUploads(sourceRoot: string, targetDir: string, mode: RestoreMode) {
  if (!readdirSync(sourceRoot).includes("uploads")) return;
  const uploadsSource = path.join(sourceRoot, "uploads");
  if (mode === "wipe") {
    rmSync(targetDir, { recursive: true, force: true });
  }
  mkdirSync(targetDir, { recursive: true });
  copyDir(uploadsSource, targetDir);
}

export async function restoreBackupArchive(options: RestoreOptions): Promise<RestoreResult> {
  const runShell = options.runShell ?? defaultRunShell;
  const directory = await extractArchive(options.archive);
  if (!readdirSync(directory).includes("dump.dump")) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Archive is missing dump.dump");
  }
  const dumpPath = path.join(directory, "dump.dump");
  const env: NodeJS.ProcessEnv = { ...process.env, PGPASSWORD: options.database.password };
  const warnings: string[] = [];

  const preflight = await runShell("pg_restore", [
    "--list",
    dumpPath,
  ], { env });
  if (preflight.code !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`pg_restore preflight failed: ${preflight.stderr.toString().trim()}`);
  }

  if (options.mode === "wipe") {
    const wipe = await runShell("psql", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      "-d", options.database.name,
      "-c", `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ${options.database.user};`,
    ], { env });
    if (wipe.code !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`psql wipe failed: ${wipe.stderr.toString().trim()}`);
    }
    const restore = await runShell("pg_restore", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      `--dbname=${options.database.name}`,
      "-j", "4",
      dumpPath,
    ], { env });
    if (restore.code !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`pg_restore failed: ${restore.stderr.toString().trim()}`);
    }
  } else {
    const restore = await runShell("pg_restore", [
      "-h", options.database.host,
      "-p", options.database.port,
      "-U", options.database.user,
      `--dbname=${options.database.name}`,
      "--data-only",
      dumpPath,
    ], { env });
    if (restore.stderr.length > 0) warnings.push(restore.stderr.toString().trim());
    if (restore.code !== 0) {
      rmSync(directory, { recursive: true, force: true });
      throw new Error(`pg_restore --data-only failed: ${restore.stderr.toString().trim()}`);
    }
  }

  copyUploads(directory, options.uploadsDir, options.mode);
  rmSync(directory, { recursive: true, force: true });
  return { mode: options.mode, warnings };
}
