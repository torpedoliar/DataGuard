import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import unzipper from "unzipper";
import { buildBackupArchive } from "./build-archive";

function readZipEntries(buffer: Buffer) {
  return unzipper.Open.buffer(buffer).then((directory) =>
    Promise.all(directory.files.map(async (file) => ({
      path: file.path,
      type: file.type,
      content: file.type === "File" ? (await file.buffer()).toString("utf8") : null,
    }))),
  );
}

describe("buildBackupArchive", () => {
  it("includes a dump.dump entry from pg_dump and uploads files", async () => {
    const uploadsRoot = mkdtempSync(path.join(tmpdir(), "dccheck-uploads-"));
    mkdirSync(path.join(uploadsRoot, "logos"), { recursive: true });
    writeFileSync(path.join(uploadsRoot, "logos", "site.png"), "fake-png");

    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk));

    const fakeRunShell = async (_command: string, args: string[]) => {
      const fileFlagIndex = args.indexOf("-f");
      if (fileFlagIndex >= 0) writeFileSync(args[fileFlagIndex + 1], "FAKE_DUMP_BYTES");
      return { code: 0, stdout: Buffer.from("STDOUT_SHOULD_NOT_BE_BUFFERED"), stderr: Buffer.from("") };
    };

    await buildBackupArchive({
      output,
      uploadsDir: uploadsRoot,
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    });

    const buffer = Buffer.concat(chunks);
    const entries = await readZipEntries(buffer);
    const paths = entries.map((entry) => entry.path).sort();
    expect(paths).toContain("dump.dump");
    expect(paths).toContain("uploads/logos/site.png");
    expect(entries.find((entry) => entry.path === "dump.dump")?.content).toBe("FAKE_DUMP_BYTES");
    rmSync(uploadsRoot, { recursive: true, force: true });
  });

  it("rejects when pg_dump exits non-zero", async () => {
    const uploadsRoot = mkdtempSync(path.join(tmpdir(), "dccheck-uploads-"));
    const output = new PassThrough();
    const fakeRunShell = async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("connection refused") });

    await expect(buildBackupArchive({
      output,
      uploadsDir: uploadsRoot,
      database: { host: "db", port: "5432", user: "administrator", password: "secret", name: "dccheck" },
      runShell: fakeRunShell,
    })).rejects.toThrow(/pg_dump failed.*connection refused/);
    rmSync(uploadsRoot, { recursive: true, force: true });
  });
});
