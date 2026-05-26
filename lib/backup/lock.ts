import { closeSync, existsSync, openSync, rmSync } from "node:fs";

export function acquireLock(path: string): boolean {
  if (existsSync(path)) return false;
  const fd = openSync(path, "wx");
  closeSync(fd);
  return true;
}

export function releaseLock(path: string): void {
  rmSync(path, { force: true });
}
