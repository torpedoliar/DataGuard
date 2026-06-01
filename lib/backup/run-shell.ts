import { spawn } from "node:child_process";

export type RunShellResult = {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
};

export type RunShellOptions = {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: Buffer | string;
};

export async function runShell(command: string, args: string[], options: RunShellOptions = {}): Promise<RunShellResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code: code ?? -1,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks),
    }));
    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}
