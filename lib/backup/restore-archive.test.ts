import archiver from "archiver";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { restoreBackupArchive } from "./restore-archive";

async function makeArchive(includeDump: boolean): Promise<Buffer> {
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
  await archive.finalize();
  await finished;
  return Buffer.concat(chunks);
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
    expect(calls.map((call) => call.command)).toEqual(["psql", "pg_restore"]);
    expect(calls[0].args).toContain("DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO administrator;");
    expect(calls[1].args).toContain("--dbname=dccheck");
    expect(result.mode).toBe("wipe");
    expect(readFileSync(path.join(workDir, "uploads", "logos", "site.png"), "utf8")).toBe("payload");
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
    expect(calls.map((call) => call.command)).toEqual(["pg_restore"]);
    expect(calls[0].args).toContain("--data-only");
    expect(result.mode).toBe("append");
    rmSync(workDir, { recursive: true, force: true });
  });
});
