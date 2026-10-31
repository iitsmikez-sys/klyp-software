/** Connected staging-only R2 durability smoke test. No customer data or AI calls. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { R2Storage } from '../lib/r2.ts';
import { r2Config, r2ObjectKey } from '../lib/r2-config.ts';
import { archiveClipFilesToR2 } from '../lib/r2-clip-archive.ts';

const phase = process.argv[2];
const stateFile = process.argv[3];
if (!['start', 'resume', 'archive', 'recover'].includes(phase) || !stateFile) {
  throw new Error('Usage: node --env-file=LOCAL_ENV scripts/smoke-r2-staging.mjs start|resume|archive|recover STATE_JSON');
}
const config = r2Config();
if (!config || config.bucket !== 'klyp-staging-20261030' || process.env.R2_WRITES_ENABLED !== '1') {
  throw new Error('Only an explicitly enabled staging bucket may be tested.');
}
const r2 = new R2Storage(config);
const userId = '00000000-0000-4000-8000-000000000001';
const first = Buffer.alloc(16 * 1024 * 1024, 0x53);
const second = Buffer.alloc(1024 * 1024, 0x7a);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readState = async () => JSON.parse(await readFile(stateFile, 'utf8'));
const saveState = async state => writeFile(stateFile, JSON.stringify(state, null, 2));

async function putPart(key, remoteId, number, bytes) {
  const url = await r2.signPart(key, remoteId, number);
  const response = await fetch(url, { method: 'PUT', body: bytes });
  if (!response.ok) throw new Error(`R2 rejected upload part ${number}: HTTP ${response.status}`);
}

if (phase === 'start') {
  const objectId = randomUUID();
  const key = r2ObjectKey('vod', userId, objectId, 'restart-test.bin');
  const remoteId = await r2.createMultipart(key, 'application/octet-stream');
  const state = { bucket: config.bucket, key, remoteId, objectId, status: 'uploading' };
  await saveState(state);
  await putPart(key, remoteId, 1, first);
  const parts = await r2.listParts(key, remoteId);
  if (parts.length !== 1 || parts[0].bytes !== first.length) throw new Error('First part did not survive upload.');
  console.log('R2_START_PASS: first 16 MiB part is durable; run resume in a new process.');
}

if (phase === 'resume') {
  const state = await readState();
  if (state.bucket !== config.bucket || state.status !== 'uploading') throw new Error('Wrong staging upload state.');
  const partsBefore = await r2.listParts(state.key, state.remoteId);
  if (partsBefore.length !== 1 || partsBefore[0].bytes !== first.length) {
    throw new Error('Uploaded part did not survive process restart.');
  }
  await putPart(state.key, state.remoteId, 2, second);
  const parts = await r2.listParts(state.key, state.remoteId);
  if (parts.length !== 2 || parts[1].bytes !== second.length) throw new Error('Resume part was not stored.');
  await r2.complete(state.key, state.remoteId, parts);
  const object = await r2.head(state.key);
  if (object?.bytes !== first.length + second.length) throw new Error('Completed upload size differs.');
  const dir = await mkdtemp(path.join(tmpdir(), 'klyp-r2-vod-'));
  const downloaded = path.join(dir, 'restart-test.bin');
  await r2.downloadFile(state.key, downloaded);
  const expectedHash = sha256(Buffer.concat([first, second]));
  if (sha256(await readFile(downloaded)) !== expectedHash) throw new Error('Completed upload checksum differs.');
  await saveState({ ...state, status: 'ready', bytes: object.bytes, sha256: expectedHash });
  console.log('R2_RESUME_PASS: part survived process restart; resumed object downloaded byte-for-byte.');
}

if (phase === 'archive') {
  const state = await readState();
  if (state.bucket !== config.bucket || state.status !== 'ready') throw new Error('Resume must pass first.');
  const dir = await mkdtemp(path.join(tmpdir(), 'klyp-r2-clip-'));
  const master = path.join(dir, 'master.mp4');
  const proxy = path.join(dir, 'proxy.mp4');
  const poster = path.join(dir, 'poster.jpg');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '3', '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'aac', master]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master,
    '-vf', 'scale=160:90', '-c:v', 'mpeg4', '-q:v', '6', '-c:a', 'aac', proxy]);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', master,
    '-frames:v', '1', poster]);
  const clipId = randomUUID();
  const manifest = await archiveClipFilesToR2(userId, clipId,
    { master, proxy, poster }, r2, dir);
  await saveState({ ...state, clipId, manifest, status: 'archived' });
  console.log('R2_ARCHIVE_PASS: playable master, preview, and poster read back with matching hashes.');
}

if (phase === 'recover') {
  const state = await readState();
  if (state.bucket !== config.bucket || state.status !== 'archived' || state.manifest?.length !== 3) {
    throw new Error('Archive must pass first.');
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'klyp-r2-recover-'));
  for (const item of state.manifest) {
    const file = path.join(dir, item.name);
    const bytes = await r2.downloadFile(item.key, file);
    if (bytes !== item.bytes || sha256(await readFile(file)) !== item.sha256) {
      throw new Error(`${item.name} changed after process restart.`);
    }
    if (item.name.endsWith('.mp4')) {
      const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' }).trim());
      if (!(duration > 2 && duration < 4)) throw new Error(`${item.name} is not playable.`);
    }
  }
  const privateUrl = `${config.endpoint}/${config.bucket}/${state.manifest[0].key}`;
  const anonymous = await fetch(privateUrl);
  // R2's unauthenticated S3 endpoint currently responds with 400 XML rather
  // than 403 for this request. Either response is a denial; a 2xx is not.
  if (![400, 401, 403, 404].includes(anonymous.status) ||
      (await anonymous.arrayBuffer()).byteLength === state.manifest[0].bytes) {
    throw new Error(`Anonymous object access was not denied (HTTP ${anonymous.status}).`);
  }
  console.log('R2_RECOVER_PASS: master, preview, and poster survived a fresh process; anonymous GET denied.');
}
