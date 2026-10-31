import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { archiveClipFilesToR2, type R2ClipManifest } from './r2-clip-archive.ts';
import type { R2Object } from './r2.ts';

export type LegacyClipMedia = { id: string; userId: string;
  masterPath: string; proxyPath: string; posterPath: string };
type Source = { read(key: string): Promise<Buffer | null> };
type Target = { putFile(key: string, file: string, type: string): Promise<number>;
  head(key: string): Promise<R2Object | null>;
  downloadFile(key: string, target: string): Promise<number> };
type RecordPort = { commit(clipId: string, manifest: R2ClipManifest[]): Promise<void> };

/** Dry-run is the default. Even apply mode copies and verifies; it has no
 * delete method and leaves the Supabase objects available for rollback. */
export async function migrateClipMedia(clip: LegacyClipMedia, source: Source,
  target: Target, record: RecordPort, options: { apply?: boolean } = {}): Promise<'missing' | 'ready' | 'migrated'> {
  const names = [
    ['master', clip.masterPath], ['proxy', clip.proxyPath], ['poster', clip.posterPath],
  ] as const;
  const originals = new Map<string, Buffer>();
  for (const [name, key] of names) {
    const bytes = await source.read(key);
    if (!bytes?.length) return 'missing';
    originals.set(name, bytes);
  }
  if (!options.apply) return 'ready';
  const dir = await mkdtemp(path.join(tmpdir(), 'klyp-r2-migrate-'));
  try {
    const files = { master: path.join(dir, 'master.mp4'), proxy: path.join(dir, 'proxy.mp4'),
      poster: path.join(dir, 'poster.jpg') };
    await Promise.all(names.map(([name]) => writeFile(files[name], originals.get(name)!)));
    const manifest = await archiveClipFilesToR2(clip.userId, clip.id, files, target, dir);
    await record.commit(clip.id, manifest);
    return 'migrated';
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
