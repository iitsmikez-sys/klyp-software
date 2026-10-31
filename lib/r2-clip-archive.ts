import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { r2ObjectKey } from './r2-config.ts';
import type { R2Object } from './r2.ts';

export type R2ClipManifest = { name: 'master.mp4' | 'proxy.mp4' | 'poster.jpg';
  key: string; bytes: number; sha256: string };
type ClipFiles = { master: string; proxy: string; poster: string };
type ArchiveStore = { putFile(key: string, file: string, type: string): Promise<number>;
  head(key: string): Promise<R2Object | null>;
  downloadFile(key: string, target: string): Promise<number> };

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Byte-for-byte remote readback is intentional: a saved clip must not be
 * declared durable based only on a successful PUT response. */
export async function archiveClipFilesToR2(userId: string, clipId: string,
  files: ClipFiles, r2: ArchiveStore, scratchDir: string): Promise<R2ClipManifest[]> {
  const source = [
    ['master.mp4', files.master, 'video/mp4'],
    ['proxy.mp4', files.proxy, 'video/mp4'],
    ['poster.jpg', files.poster, 'image/jpeg'],
  ] as const;
  const manifest: R2ClipManifest[] = [];
  for (const [name, local, contentType] of source) {
    const key = r2ObjectKey('clips', userId, clipId, name);
    const bytes = (await stat(local)).size;
    if (bytes < 1) throw new Error('Empty clip archive file.');
    const digest = await sha256(local);
    const uploaded = await r2.putFile(key, local, contentType);
    const remote = await r2.head(key);
    if (uploaded !== bytes || remote?.bytes !== bytes) throw new Error('Clip archive verification failed.');
    const proof = path.join(scratchDir, `${name}.${randomUUID()}.verify`);
    try {
      const downloaded = await r2.downloadFile(key, proof);
      if (downloaded !== bytes || (await sha256(proof)) !== digest) {
        throw new Error('Clip archive verification failed.');
      }
    } finally { await rm(proof, { force: true }).catch(() => {}); }
    manifest.push({ name, key, bytes, sha256: digest });
  }
  return manifest;
}
