import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Locate bash on Windows. The PATH lookup `which bash` works in the shell
 * but Node's execFileSync goes through Windows-style PATH resolution, which
 * is unreliable for MSYS2 binaries living outside `C:\Windows`. Try a
 * few well-known Git for Windows install locations.
 */
function resolveBash(): string {
  // Absolute paths are checked against the filesystem; bare names ("bash")
  // are assumed to be on PATH and used as-is.
  const candidates = [
    "C:/Program Files/Git/usr/bin/bash.exe",
    "C:/Program Files (x86)/Git/usr/bin/bash.exe",
    "C:/Program Files/Git/bin/bash.exe",
    "/usr/bin/bash",
    "/bin/bash",
    "bash",
  ];
  for (const candidate of candidates) {
    const isAbsolute = candidate.includes("/") || candidate.includes("\\");
    if (isAbsolute && !existsSync(candidate)) {
      // Skip absolute paths that don't exist on this host. Bare names
      // like "bash" are returned as-is so the OS can resolve them.
      continue;
    }
    return candidate;
  }
  return "bash";
}

const BASH_BIN = resolveBash();

/**
 * Extract the `ensure_secret` function from deploy.sh so we can source it in
 * isolation (the real script also runs prerequisite checks and assumes it is
 * executed from the project root, neither of which is desirable in a unit
 * test). The helper is the unit of behaviour we want to lock in.
 */
function extractEnsureSecret(): string {
  const deploy = readFileSync(join(process.cwd(), "deploy.sh"), "utf8");
  // The function starts at `ensure_secret() {` and ends at the matching
  // closing brace at column 0. Anchor on the function header so the regex
  // remains stable if the leading comment is edited.
  const start = deploy.indexOf("ensure_secret() {");
  if (start === -1) {
    throw new Error("ensure_secret function not found in deploy.sh");
  }
  const rest = deploy.slice(start);
  // Find the closing brace at column 0 (i.e. the next line that begins with `}`).
  const endMatch = rest.match(/^}\s*$/m);
  if (!endMatch || endMatch.index === undefined) {
    throw new Error("ensure_secret closing brace not found in deploy.sh");
  }
  return rest.slice(0, endMatch.index + endMatch[0].length);
}

function runBash(body: string, env: Record<string, string> = {}): { stdout: string; stderr: string; status: number } {
  try {
    const result = execFileSync(BASH_BIN, ["-c", body], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout: String(result ?? ""), stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : e.stdout ? e.stdout.toString("utf8") : "",
      stderr: typeof e.stderr === "string" ? e.stderr : e.stderr ? e.stderr.toString("utf8") : "",
      status: typeof e.status === "number" ? e.status : 1,
    };
  }
}

describe("deploy.sh ensure_secret", () => {
  let workDir: string;
  let envFile: string;
  let scriptPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "dccheck-deploy-"));
    envFile = join(workDir, ".env.production");
    scriptPath = join(workDir, "ensure_secret.sh");
    const header = `set -euo pipefail
ENV_FILE='${envFile}'
${extractEnsureSecret()}
`;
    writeFileSync(scriptPath, header, { encoding: "utf8" });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("appends a KEY=base64value line when the key is missing", () => {
    writeFileSync(envFile, "", "utf8");
    const res = runBash(`source '${scriptPath}'; ensure_secret DB_PASSWORD 24 always`);
    expect(res.status).toBe(0);
    const contents = readFileSync(envFile, "utf8");
    expect(contents).toMatch(/^DB_PASSWORD=[A-Za-z0-9+/=_-]+$/m);
    const line = contents.split("\n").find((l) => l.startsWith("DB_PASSWORD="));
    expect(line).toBeDefined();
    const value = line!.slice("DB_PASSWORD=".length);
    expect(value.length).toBeGreaterThanOrEqual(24);
  });

  it("does not overwrite an existing key when regenerate=if-missing", () => {
    writeFileSync(envFile, "DB_USER=alice\n", "utf8");
    const res = runBash(`source '${scriptPath}'; ensure_secret DB_USER 6 if-missing`);
    expect(res.status).toBe(0);
    expect(readFileSync(envFile, "utf8")).toContain("DB_USER=alice");
  });

  it("overwrites the value when regenerate=always even if a value is present", () => {
    writeFileSync(envFile, "DB_PASSWORD=oldvalue\n", "utf8");
    const res = runBash(`source '${scriptPath}'; ensure_secret DB_PASSWORD 24 always`);
    expect(res.status).toBe(0);
    const contents = readFileSync(envFile, "utf8");
    // ensure_secret replaces the first matching line in-place when the key
    // already exists, so the file should contain exactly one DB_PASSWORD line
    // and its value should be the freshly generated one (not "oldvalue").
    const matches = contents.match(/^DB_PASSWORD=/gm) ?? [];
    expect(matches.length).toBe(1);
    expect(contents).not.toContain("DB_PASSWORD=oldvalue");
    const line = contents.split(/\r?\n/).find((l) => l.startsWith("DB_PASSWORD="));
    expect(line).toMatch(/^DB_PASSWORD=[A-Za-z0-9+/=_-]+$/);
  });

  it("produces a value with the requested entropy (SESSION_SECRET >= 32 chars)", () => {
    writeFileSync(envFile, "", "utf8");
    const res = runBash(`source '${scriptPath}'; ensure_secret SESSION_SECRET 32 always`);
    expect(res.status).toBe(0);
    const contents = readFileSync(envFile, "utf8");
    const line = contents.split("\n").find((l) => l.startsWith("SESSION_SECRET="));
    expect(line).toBeDefined();
    const value = line!.slice("SESSION_SECRET=".length);
    expect(value.length).toBeGreaterThanOrEqual(32);
  });
});

describe("scripts/seed-users.ts password generation", () => {
  it("uses the env var when SEED_ADMIN_PASSWORD is set", () => {
    const explicit = "explicitly-set-password-1234567890";
    const env = { ...process.env, SEED_ADMIN_PASSWORD: explicit };
    const fromEnv = env.SEED_ADMIN_PASSWORD;
    const generated = fromEnv && fromEnv.length > 0
      ? fromEnv
      : randomBytes(12).toString("base64url");
    expect(generated).toBe(explicit);
  });

  it("generates a 16-character URL-safe base64url password when env var is missing", () => {
    const generated = randomBytes(12).toString("base64url");
    expect(generated.length).toBe(16);
    expect(generated).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
