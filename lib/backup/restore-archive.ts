import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { rm as fsRm } from "node:fs/promises";
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

type RestoreTool = {
  command: "pg_restore" | "pg_restore17";
  pipeSql: boolean;
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

function copyDir(from: string, to: string, retries = 4): void {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(toPath, { recursive: true });
      copyDir(fromPath, toPath, retries);
    } else {
      copyFileWithRetry(fromPath, toPath, retries);
    }
  }
}

function copyFileWithRetry(from: string, to: string, remaining: number): void {
  try {
    copyFileSync(from, to);
  }
  catch (error) {
    if (remaining > 0 && isBusyError(error)) {
      copyFileWithRetry(from, to, remaining - 1);
    }
    else {
      throw error;
    }
  }
}

function isBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  return code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY" || code === "EACCES";
}

async function removeUploadsTarget(targetDir: string): Promise<void> {
  // First, try to remove the directory entirely (works when it's a regular directory).
  try {
    await fsRm(targetDir, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
    return;
  }
  catch (error) {
    if (!isBusyError(error)) throw error;
    // EBUSY/EPERM on the directory itself typically means it's a mount point
    // (e.g. a Docker volume). Fall through to clear contents instead.
  }

  // Fallback: clear the *contents* of the directory without removing the
  // directory itself.  This is the expected path when uploadsDir is a Docker
  // named‑volume mount point — the OS will not allow removing or renaming a
  // mount point, but removing individual children is fine.
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(targetDir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or is inaccessible — nothing to clean.
    return;
  }

  const errors: Error[] = [];
  for (const entry of entries) {
    const childPath = path.join(targetDir, entry.name);
    try {
      await fsRm(childPath, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  if (errors.length > 0 && errors.length === entries.length) {
    // Every single child failed — this is a real problem.
    throw Object.assign(
      new Error(`Could not clear uploads directory: ${targetDir}. ${errors[0].message}`),
      { code: "EBUSY" },
    );
  }
  // Partial failures are tolerated — remaining files will be overwritten by
  // the incoming archive contents.
}

async function copyUploads(sourceRoot: string, targetDir: string, mode: RestoreMode): Promise<void> {
  if (!readdirSync(sourceRoot).includes("uploads")) return;
  const uploadsSource = path.join(sourceRoot, "uploads");
  if (mode === "wipe") {
    await removeUploadsTarget(targetDir);
  }
  mkdirSync(targetDir, { recursive: true });
  copyDir(uploadsSource, targetDir);
}

function connectionArgs(database: DatabaseTarget): string[] {
  return [
    "-h", database.host,
    "-p", database.port,
    "-U", database.user,
    "-d", database.name,
  ];
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isUnsupportedDumpVersion(stderr: string): boolean {
  return /unsupported version \([^)]+\) in file header/.test(stderr);
}

async function selectRestoreTool(
  runShell: RestoreOptions["runShell"],
  dumpPath: string,
  env: NodeJS.ProcessEnv,
): Promise<RestoreTool> {
  const preflight = await runShell!("pg_restore", ["--list", dumpPath], { env });
  if (preflight.code === 0) return { command: "pg_restore", pipeSql: false };

  const stderr = preflight.stderr.toString().trim();
  if (!isUnsupportedDumpVersion(stderr)) {
    throw new Error(`pg_restore preflight failed: ${stderr}`);
  }

  let fallback: RunShellResult;
  try {
    fallback = await runShell!("pg_restore17", ["--list", dumpPath], { env });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`pg_restore preflight failed: ${stderr}; pg_restore17 unavailable: ${message}`);
  }

  if (fallback.code !== 0) {
    throw new Error(`pg_restore preflight failed: ${stderr}; pg_restore17 preflight failed: ${fallback.stderr.toString().trim()}`);
  }

  return { command: "pg_restore17", pipeSql: true };
}

async function listUserSchemas(
  runShell: RestoreOptions["runShell"],
  database: DatabaseTarget,
  env: NodeJS.ProcessEnv,
): Promise<string[]> {
  const query = "SELECT nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg_%' ORDER BY nspname";
  const result = await runShell!("psql", [
    ...connectionArgs(database),
    "-A",
    "-t",
    "-c", query,
  ], { env });

  if (result.code !== 0) {
    throw new Error(`psql schema listing failed: ${result.stderr.toString().trim()}`);
  }

  return result.stdout.toString().split(/\r?\n/).map((schema) => schema.trim()).filter(Boolean);
}

async function wipeDatabase(
  runShell: RestoreOptions["runShell"],
  database: DatabaseTarget,
  env: NodeJS.ProcessEnv,
) {
  const schemas = await listUserSchemas(runShell, database, env);
  const dropStatements = schemas.map((schema) => `DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE;`);
  const publicSchema = quoteIdentifier("public");
  const user = quoteIdentifier(database.user);
  const sql = [
    ...dropStatements,
    `CREATE SCHEMA ${publicSchema};`,
    `ALTER SCHEMA ${publicSchema} OWNER TO ${user};`,
    `GRANT ALL ON SCHEMA ${publicSchema} TO ${user};`,
    `GRANT ALL ON SCHEMA ${publicSchema} TO public;`,
  ].join(" ");

  const wipe = await runShell!("psql", [
    ...connectionArgs(database),
    "-v", "ON_ERROR_STOP=1",
    "-c", sql,
  ], { env });

  if (wipe.code !== 0) {
    throw new Error(`psql wipe failed: ${wipe.stderr.toString().trim()}`);
  }
}

function filterUnsupportedSql(sql: string): string {
  const lines = sql.split(/\r?\n/);
  const output: string[] = [];
  let inCopy = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inCopy && /^SET\s+transaction_timeout\s*=/.test(trimmed)) continue;

    output.push(line);

    if (!inCopy && /^COPY\s+.+\s+FROM\s+stdin;$/i.test(trimmed)) {
      inCopy = true;
    } else if (inCopy && trimmed === "\\.") {
      inCopy = false;
    }
  }

  return output.join("\n");
}

async function restoreDirect(
  runShell: RestoreOptions["runShell"],
  tool: RestoreTool,
  options: RestoreOptions,
  dumpPath: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const args = [
    "-h", options.database.host,
    "-p", options.database.port,
    "-U", options.database.user,
    `--dbname=${options.database.name}`,
  ];

  if (options.mode === "wipe") {
    args.push("-j", "4");
  } else {
    args.push("--data-only");
  }
  args.push(dumpPath);

  const restore = await runShell!(tool.command, args, { env });
  const stderr = restore.stderr.toString().trim();
  if (restore.code !== 0) {
    throw new Error(`pg_restore failed: ${stderr}`);
  }
  return stderr.length > 0 ? stderr : null;
}

async function restoreViaSqlPipe(
  runShell: RestoreOptions["runShell"],
  tool: RestoreTool,
  options: RestoreOptions,
  dumpPath: string,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  const dumpArgs = [
    "-f", "-",
    "--no-owner",
    "--no-privileges",
    ...(options.mode === "append" ? ["--data-only"] : []),
    dumpPath,
  ];
  const dump = await runShell!(tool.command, dumpArgs, { env });
  if (dump.code !== 0) {
    throw new Error(`pg_restore failed: ${dump.stderr.toString().trim()}`);
  }

  const sql = filterUnsupportedSql(dump.stdout.toString());
  const restore = await runShell!("psql", [
    ...connectionArgs(options.database),
    "-v", "ON_ERROR_STOP=1",
  ], { env, input: sql });

  const stderr = [dump.stderr.toString().trim(), restore.stderr.toString().trim()].filter(Boolean).join("\n");
  if (restore.code !== 0) {
    throw new Error(`psql restore failed: ${restore.stderr.toString().trim()}`);
  }
  return stderr.length > 0 ? stderr : null;
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

  try {
    const tool = await selectRestoreTool(runShell, dumpPath, env);

    if (options.mode === "wipe") {
      await wipeDatabase(runShell, options.database, env);
    }

    const warning = tool.pipeSql
      ? await restoreViaSqlPipe(runShell, tool, options, dumpPath, env)
      : await restoreDirect(runShell, tool, options, dumpPath, env);
    if (warning) warnings.push(warning);

    await copyUploads(directory, options.uploadsDir, options.mode);
    return { mode: options.mode, warnings };
  }
  finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
