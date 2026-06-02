import archiver from "archiver";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { restoreBackupArchive } from "./restore-archive";

async function makeArchive(includeDump: boolean, extraEntries: { name: string; content: string }[] = []): Promise<Buffer> {
  const archive = archiver("zip");
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => {
    stream.on("end", resolve);
    stream.on("finish", resolve);
  });
  archive.pipe(stream);
  if (includeDump) archive.append("DUMP_BYTES", { name: "dump.dump" });
  archive.append("payload", { name: "uploads/logos/site.png" });
  for (const entry of extraEntries) archive.append(entry.content, { name: entry.name });
  await archive.finalize();
  await finished;
  return Buffer.concat(chunks);
}
function renameZipEntry(buffer: Buffer, from: string, to: string): Buffer {
  expect(Buffer.byteLength(from)).toBe(Buffer.byteLength(to));
  const output = Buffer.from(buffer);
  const fromBytes = Buffer.from(from);
  const toBytes = Buffer.from(to);
  let offset = output.indexOf(fromBytes);
  let replacements = 0;
  while (offset >= 0) {
    toBytes.copy(output, offset);
    replacements++;
    offset = output.indexOf(fromBytes, offset + toBytes.length);
  }
  expect(replacements).toBeGreaterThan(0);
  return output;
}


describe("restoreBackupArchive", () => {
  it("rejects an archive without dump.dump", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(false);
    await expect(restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    })).rejects.toThrow(/dump\.dump/);
    rmSync(workDir, { recursive: true, force: true });
  });



  it("rejects archive entries outside the restore directory", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = renameZipEntry(await makeArchive(true, [{ name: "AAAevil.txt", content: "owned" }]), "AAAevil.txt", "../evil.txt");
    await expect(restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }),
    })).rejects.toThrow(/outside restore directory/);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("falls back to PostgreSQL 17 pg_restore and filters transaction_timeout before psql restore", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(true);
    const calls: { command: string; args: string[]; input?: Buffer | string }[] = [];
    const fakeRunShell = async (command: string, args: string[], options?: { input?: Buffer | string }) => {
      calls.push({ command, args, input: options?.input });
      if (command === "pg_restore" && args.includes("--list")) {
        return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("pg_restore: error: unsupported version (1.16) in file header") };
      }
      if (command === "pg_restore17" && args.includes("--list")) {
        return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      }
      if (command === "psql" && args.includes("-t")) {
        return { code: 0, stdout: Buffer.from(" public \n"), stderr: Buffer.alloc(0) };
      }
      if (command === "pg_restore17") {
        return { code: 0, stdout: Buffer.from("SET transaction_timeout = 0;\nCREATE TABLE sites(id integer);\n"), stderr: Buffer.alloc(0) };
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };

    const result = await restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });

    const restorePsql = calls.find((call) => call.command === "psql" && call.input !== undefined);
    expect(result.mode).toBe("wipe");
    expect(calls.map((call) => call.command)).toEqual(["pg_restore", "pg_restore17", "psql", "psql", "pg_restore17", "psql"]);
    expect(calls[0].args).toContain("--list");
    expect(calls[1].args).toContain("--list");
    const dumpCall = calls[4];
    expect(dumpCall.args).toContain("-f");
    expect(dumpCall.args).toContain("-");
    expect(dumpCall.args).toContain("--no-owner");
    expect(dumpCall.args).not.toContain("--dbname=dccheck");
    expect(restorePsql?.input?.toString()).not.toContain("transaction_timeout");
    expect(restorePsql?.input?.toString()).toContain("CREATE TABLE sites");
    rmSync(workDir, { recursive: true, force: true });
  });

  it("checks that pg_restore can read the dump before wiping the database", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(true);
    const calls: { command: string; args: string[] }[] = [];
    const fakeRunShell = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "pg_restore" || command === "pg_restore17") {
        return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("pg_restore: error: unsupported version (1.16) in file header") };
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };

    await expect(restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    })).rejects.toThrow(/unsupported version/);

    expect(calls.map((call) => call.command)).toEqual(["pg_restore", "pg_restore17"]);
    expect(calls[0].args).toContain("--list");
    expect(calls[1].args).toContain("--list");
    rmSync(workDir, { recursive: true, force: true });
  });

  it("drops every non-system schema before wipe restore", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(true);
    const calls: { command: string; args: string[] }[] = [];
    const fakeRunShell = async (command: string, args: string[]) => {
      calls.push({ command, args });
      if (command === "psql" && args.includes("-t")) {
        return { code: 0, stdout: Buffer.from(" public \n drizzle \n custom_schema \n"), stderr: Buffer.alloc(0) };
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };

    await restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });

    const psqlCommands = calls.filter((call) => call.command === "psql");
    const schemaQuery = psqlCommands[0].args.join(" ");
    const wipeSql = psqlCommands[1].args.join(" ");
    expect(schemaQuery).toContain("SELECT nspname FROM pg_namespace");
    expect(wipeSql).toContain('DROP SCHEMA IF EXISTS "public" CASCADE;');
    expect(wipeSql).toContain('DROP SCHEMA IF EXISTS "drizzle" CASCADE;');
    expect(wipeSql).toContain('DROP SCHEMA IF EXISTS "custom_schema" CASCADE;');
    expect(wipeSql).toContain('CREATE SCHEMA "public";');
    rmSync(workDir, { recursive: true, force: true });
  });

  it("runs DROP SCHEMA, pg_restore, and copies uploads in wipe mode", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(true);
    const calls: { command: string; args: string[] }[] = [];
    const fakeRunShell = async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };
    const result = await restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });
    expect(calls.map((call) => call.command)).toEqual(["pg_restore", "psql", "psql", "pg_restore"]);
    expect(calls[0].args).toContain("--list");
    expect(calls[2].args.join(" ")).toContain('CREATE SCHEMA "public";');
    expect(calls[3].args).toContain("--dbname=dccheck");
    expect(result.mode).toBe("wipe");
    expect(readFileSync(path.join(workDir, "uploads", "logos", "site.png"), "utf8")).toBe("payload");
    rmSync(workDir, { recursive: true, force: true });
  });

  it("does not hide duplicate key errors in append mode", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(true);
    let restoreCalls = 0;
    const fakeRunShell = async (command: string, args: string[]) => {
      if (command === "pg_restore" && args.includes("--list")) {
        return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      }
      if (command === "pg_restore") {
        restoreCalls++;
        return { code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('pg_restore: error: COPY failed for table "users": ERROR: duplicate key value violates unique constraint "users_pkey"') };
      }
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };

    await expect(restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "append",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    })).rejects.toThrow(/duplicate key value/);

    expect(restoreCalls).toBe(1);
    rmSync(workDir, { recursive: true, force: true });
  });

  it("runs pg_restore --data-only in append mode", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const archive = await makeArchive(true);
    const calls: { command: string; args: string[] }[] = [];
    const fakeRunShell = async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };
    const result = await restoreBackupArchive({
      archive,
      uploadsDir: path.join(workDir, "uploads"),
      mode: "append",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });
    expect(calls.map((call) => call.command)).toEqual(["pg_restore", "pg_restore"]);
    expect(calls[0].args).toContain("--list");
    expect(calls[1].args).toContain("--data-only");
    expect(result.mode).toBe("append");
    rmSync(workDir, { recursive: true, force: true });
  });

  it("replaces the uploads directory in wipe mode and verifies archive content is restored", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "dccheck-restore-"));
    const uploadsDir = path.join(workDir, "uploads");
    mkdirSync(uploadsDir, { recursive: true });
    writeFileSync(path.join(uploadsDir, "old.txt"), "previous");
    const archive = await makeArchive(true);
    const fakeRunShell = async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });

    const result = await restoreBackupArchive({
      archive,
      uploadsDir,
      mode: "wipe",
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });

    expect(result.mode).toBe("wipe");
    // old file should be gone; archive uploads should be present
    expect(readFileSync(path.join(uploadsDir, "logos", "site.png"), "utf8")).toBe("payload");
    expect(() => readFileSync(path.join(uploadsDir, "old.txt"), "utf8")).toThrow();
    rmSync(workDir, { recursive: true, force: true });
  });
});
