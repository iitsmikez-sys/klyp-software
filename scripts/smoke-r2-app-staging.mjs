/** Local Supabase + private R2 connected smoke test. Synthetic media only.
 * Keep STATE_JSON outside Git; it contains a short-lived test bearer token.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';

const phase = process.argv[2];
const stateFile = process.argv[3];
const sourceFile = process.argv[4];
const local = process.env.API_URL;
const app = process.env.KLYP_STAGING_APP_URL ?? 'http://127.0.0.1:3199';
const anon = process.env.ANON_KEY;
const service = process.env.SERVICE_ROLE_KEY;
if (!['start', 'resume', 'save', 'download'].includes(phase) || !stateFile ||
    !local?.startsWith('http://127.0.0.1:') || !app.startsWith('http://127.0.0.1:') ||
    !anon || !service || process.env.R2_BUCKET !== 'klyp-staging-20261030') {
  throw new Error('Isolated local Supabase and R2 staging settings are required.');
}
const json = async response => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.msg ?? data.message ?? data.error ?? 'request failed'}`);
  return data;
};
const appPost = (path, token, body) => fetch(app + path, { method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify(body) });
const adminHeaders = { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' };
const userHeaders = token => ({ apikey: anon, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const readState = async () => JSON.parse(await readFile(stateFile, 'utf8'));
const saveState = async state => writeFile(stateFile, JSON.stringify(state, null, 2));

if (phase === 'start') {
  if (!sourceFile) throw new Error('start requires an output path for the synthetic MP4.');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '6', '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'aac', sourceFile]);
  const email = `r2-smoke-${randomUUID()}@example.test`;
  const password = randomBytes(32).toString('hex');
  const created = await json(await fetch(`${local}/auth/v1/admin/users`, { method: 'POST',
    headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) }));
  const signedIn = await json(await fetch(`${local}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }) }));
  if (!created.id || !signedIn.access_token) throw new Error('Local test user could not sign in.');
  const bytes = (await stat(sourceFile)).size;
  const upload = await json(await appPost('/api/upload/r2', signedIn.access_token,
    { action: 'start', fileName: 'synthetic-vod.mp4', bytes }));
  const part = await json(await appPost('/api/upload/r2', signedIn.access_token,
    { action: 'part', uploadId: upload.id, partNumber: 1 }));
  const content = await readFile(sourceFile);
  const sent = await fetch(part.url, { method: 'PUT', body: content });
  if (!sent.ok) throw new Error(`Signed upload failed: HTTP ${sent.status}`);
  const status = await json(await fetch(`${app}/api/upload/r2?uploadId=${upload.id}`, {
    headers: { authorization: `Bearer ${signedIn.access_token}` } }));
  if (status.status !== 'uploading' || status.completedParts?.join(',') !== '1') {
    throw new Error('Klyp did not persist the uploaded part.');
  }
  await saveState({ userId: created.id, token: signedIn.access_token, uploadId: upload.id,
    sourceFile, sourceSha256: createHash('sha256').update(content).digest('hex'), status: 'uploaded' });
  console.log('KLYP_R2_APP_UPLOAD_PASS: local user signed in and uploaded a synthetic VOD part. Restart the app server.');
}

if (phase === 'resume') {
  const state = await readState();
  if (state.status !== 'uploaded') throw new Error('Upload phase must pass first.');
  const status = await json(await fetch(`${app}/api/upload/r2?uploadId=${state.uploadId}`, {
    headers: { authorization: `Bearer ${state.token}` } }));
  if (status.status !== 'uploading' || status.completedParts?.join(',') !== '1') {
    throw new Error('Upload state was lost after the app restart.');
  }
  const finished = await json(await appPost('/api/upload/r2', state.token,
    { action: 'finish', uploadId: state.uploadId }));
  if (finished.uploadId !== state.uploadId || finished.durationSeconds < 5 ||
      finished.durationSeconds > 7) throw new Error('Klyp did not verify the resumed VOD.');
  await saveState({ ...state, status: 'ready', durationSeconds: finished.durationSeconds });
  console.log('KLYP_R2_APP_RESUME_PASS: app restart preserved upload state and FFprobe verified the VOD.');
}

if (phase === 'save') {
  const state = await readState();
  if (state.status !== 'ready') throw new Error('Resume phase must pass first.');
  const source = `upload:${state.uploadId}`;
  const clip = await json(await fetch(`${local}/rest/v1/clips?select=id,archive_status`, {
    method: 'POST', headers: { ...userHeaders(state.token), prefer: 'return=representation' },
    body: JSON.stringify({ user_id: state.userId, url: source,
      title: 'Synthetic R2 durability test', clip_type: 'FUNNY', viral_score: 50,
      caption: 'Local storage test', reason: 'Verify archive durability after restart.',
      start_seconds: 0, end_seconds: 3 }) }));
  if (!clip[0]?.id || clip[0].archive_status !== 'pending') throw new Error('Clip archive job was not queued.');
  await saveState({ ...state, clipId: clip[0].id, status: 'queued' });
  console.log('KLYP_R2_APP_SAVE_QUEUED: clip is pending, not falsely marked saved. Start the archive worker.');
}

if (phase === 'download') {
  const state = await readState();
  if (state.status !== 'queued') throw new Error('Save phase must pass first.');
  let clip;
  for (let i = 0; i < 30; i++) {
    const rows = await json(await fetch(`${local}/rest/v1/clips?id=eq.${state.clipId}&select=archive_status,archive_provider,master_path,proxy_path,poster_path`,
      { headers: adminHeaders }));
    clip = rows[0];
    if (clip?.archive_status === 'stored') break;
    if (clip?.archive_status === 'unavailable' || clip?.archive_status === 'failed') {
      throw new Error(`Clip archive failed: ${clip.archive_status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (clip?.archive_status !== 'stored' || clip.archive_provider !== 'r2' ||
      !clip.master_path || !clip.proxy_path || !clip.poster_path) {
    throw new Error('Clip was not durably archived to R2.');
  }
  // Make the original VOD unavailable in the isolated database. Only the
  // archive can serve the next requests; no R2 object is deleted.
  await json(await fetch(`${local}/rest/v1/vod_uploads?id=eq.${state.uploadId}`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'expired' }) }));
  const body = { clip_id: state.clipId, url: `upload:${state.uploadId}`,
    start_seconds: 0, end_seconds: 3, crop: false };
  const preview = await appPost('/api/preview', state.token, body);
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  if (!preview.ok || preview.headers.get('x-klyp-source') !== 'archive' || previewBytes.length < 1000) {
    throw new Error(`Archived preview unavailable: HTTP ${preview.status}`);
  }
  const exportResponse = await appPost('/api/clip', state.token, { ...body, raw: true });
  const exportBytes = Buffer.from(await exportResponse.arrayBuffer());
  if (!exportResponse.ok || exportBytes.length < 1000 ||
      !exportResponse.headers.get('content-type')?.includes('video/mp4')) {
    throw new Error(`Archived download unavailable: HTTP ${exportResponse.status}`);
  }
  const exportFile = `${state.sourceFile}.recovered.mp4`;
  await writeFile(exportFile, exportBytes);
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', exportFile], { encoding: 'utf8' }).trim());
  if (!(duration > 2 && duration < 4)) throw new Error('Downloaded clip is not playable.');
  await saveState({ ...state, status: 'verified', archiveProvider: clip.archive_provider,
    previewBytes: previewBytes.length, downloadBytes: exportBytes.length });
  console.log('KLYP_R2_APP_DOWNLOAD_PASS: stored R2 clip previewed and downloaded after source VOD was unavailable.');
}
