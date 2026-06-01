import { closeSync, openSync, rmSync } from "node:fs";

export function acquireLock(path: string): boolean {
  try {
    const fd = openSync(path, "wx");
    closeSync(fd);
    return true;
  }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

export function releaseLock(path: string): void {
  rmSync(path, { force: true });
}
