import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

export async function saveUploadFile(file: File, prefix: string): Promise<string | null> {
  if (!file || file.size === 0 || file.name === "undefined") return null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const fileName = `${prefix}-${timestamp}-${safeName}`;
  const uploadDir = path.join(process.cwd(), "public/uploads");

  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, fileName), buffer);

  return `/uploads/${fileName}`;
}
