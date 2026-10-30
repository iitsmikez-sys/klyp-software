import { readdir } from "node:fs/promises";
import path from "node:path";

const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function uploadDirectory(cacheDir: string, configured = process.env.KLYP_UPLOAD_DIR): string {
  return configured ? path.resolve(configured) : cacheDir;
}

export async function locateUploadedFile(uploadId: string, directories: string[]): Promise<string | null> {
  if (!UPLOAD_ID_PATTERN.test(uploadId)) return null;
  for (const dir of new Set(directories)) {
    try {
      const files = await readdir(dir);
      const match = files.find((file) => file.startsWith(`upload-${uploadId}.`));
      if (match) return path.join(dir, match);
    } catch { /* missing directory; try the next location */ }
  }
  return null;
}
