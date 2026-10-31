/** Explicit, one-clip-at-a-time migration. Dry-run by default; never deletes. */
import { createClient } from '@supabase/supabase-js';
import { migrateClipMedia } from '../lib/r2-clip-migration.ts';
import { r2Storage } from '../lib/r2.ts';

const args = new Set(process.argv.slice(2));
const clipId = process.argv.find((arg, i) => process.argv[i - 1] === '--clip-id');
const apply = args.has('--apply');
if (!clipId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clipId)) {
  throw new Error('Provide exactly one --clip-id UUID. Migration is dry-run unless --apply is given.');
}
if (apply && process.env.KLYP_R2_MIGRATION_APPROVED !== 'staging') {
  throw new Error('Apply mode requires KLYP_R2_MIGRATION_APPROVED=staging. Never run against production without separate approval.');
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase service configuration is missing.');
const admin = createClient(url, key, { auth: { persistSession: false } });
const r2 = r2Storage();
if (!r2) throw new Error('Private R2 is not configured.');
const { data: clip, error } = await admin.from('clips')
  .select('id,user_id,master_path,proxy_path,poster_path,archive_status,archive_provider')
  .eq('id', clipId).maybeSingle();
if (error || !clip || clip.archive_status !== 'stored' || clip.archive_provider !== 'supabase' ||
    !clip.master_path || !clip.proxy_path || !clip.poster_path) {
  throw new Error('Clip has no complete Supabase archive to migrate.');
}
const source = { async read(objectPath) {
  const { data, error: downloadError } = await admin.storage.from('clip-media').download(objectPath);
  return downloadError || !data ? null : Buffer.from(await data.arrayBuffer());
} };
const record = { async commit(id, manifest) {
  const { error: commitError } = await admin.rpc('mark_clip_migrated_to_r2', {
    p_clip_id: id, p_manifest: manifest,
  });
  if (commitError) throw commitError;
} };
const result = await migrateClipMedia({ id: clip.id, userId: clip.user_id,
  masterPath: clip.master_path, proxyPath: clip.proxy_path, posterPath: clip.poster_path },
  source, r2, record, { apply });
console.log(`[r2-migration] ${clip.id} ${result}; Supabase originals retained`);
