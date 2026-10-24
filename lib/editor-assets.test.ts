import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorAssetService, validateEditorUpload, validateEditorAssetMetadata, EditorAssetError, type EditorAsset, type EditorAssetRepository } from './editor-assets.ts';

const photo = { kind: 'photo' as const, mime_type: 'image/png', size_bytes: 100, width: 64, height: 48, duration_ms: null };
const video = { kind: 'video' as const, mime_type: 'video/mp4', size_bytes: 100, width: 64, height: 48, duration_ms: 60000 };

for(const status of ['verified','pending','failed']) test(`deleted ${status} asset cleanup survives row deletion and token replay, and retries storage failures`,async()=>{
 const f=fixture(),path=`deleted-user/deleted-clip/${status}.png`;
 // The DB trigger's durable output is independent of the now-absent clip/account.
 f.cleanup.set(path,'2999-01-01T00:00:00Z');
 if(status!=='pending')f.objects.add(path);
 await f.service.cleanupExpiredUploads();
 assert.equal(f.cleanup.has(path),true,'do not consume a manifest before the token expiry buffer');
 // A still-valid upload token can create the object after the owning row was deleted.
 f.objects.add(path);f.cleanup.set(path,'2000-01-01T00:00:00Z');
 const remove=f.repo.removeObjects;
 f.repo.removeObjects=async()=>{throw new EditorAssetError('Storage outage',503);};
 await assert.rejects(f.service.cleanupExpiredUploads(),/outage/);
 assert.equal(f.cleanup.has(path),true,'failure must retain the only storage cleanup manifest');
 f.repo.removeObjects=remove;
 await f.service.cleanupExpiredUploads();
 assert.equal(f.objects.has(path),false);assert.equal(f.cleanup.has(path),false);
 await f.service.cleanupExpiredUploads();
});

test('queue acknowledgement failure retries idempotent removal without losing the manifest',async()=>{
 const f=fixture(),path='deleted/object.png';f.cleanup.set(path,'2000-01-01T00:00:00Z');f.objects.add(path);
 const acknowledge=f.repo.deleteCleanupRecords;f.repo.deleteCleanupRecords=async()=>{throw new EditorAssetError('Database outage',503);};
 await assert.rejects(f.service.cleanupExpiredUploads(),/outage/);
 assert.equal(f.objects.has(path),false);assert.equal(f.cleanup.has(path),true);
 f.repo.deleteCleanupRecords=acknowledge;await f.service.cleanupExpiredUploads();assert.equal(f.cleanup.has(path),false);
});
function fixture() {
 const rows = new Map<string, EditorAsset>();
 const objects = new Set<string>();
 const cleanup = new Map<string,string>();
 let pro = true, clipOwner = 'user', missing = false;
 const repo: EditorAssetRepository = {
  async access() { return { owner: clipOwner, tier: pro ? 'pro' : 'free', subscription: pro ? 'sub' : null }; },
  async insert(row) { if (missing) throw new EditorAssetError('Editor media unavailable: apply migration 015_editor_media.sql.', 503); rows.set(row.id, row); },
  async find(user, clip, id) { const row = rows.get(id); return row?.user_id === user && row.clip_id === clip ? row : null; },
  async list(user, clip) { return Array.from(rows.values()).filter(a => a.user_id === user && a.clip_id === clip && a.status === 'verified'); },
  async verify(row, metadata) { const next = { ...row, ...metadata, status: 'verified' as const, verified_at: new Date().toISOString() }; rows.set(row.id, next); return next; },
  async fail(row) { if(rows.get(row.id)?.status!=='pending') return false; rows.set(row.id, { ...row, status: 'failed' }); return true; },
  async signUpload(path) { return { signedUrl: 'https://storage.test/upload', token: 'signed-token', path }; },
  async signPreview(path) { if (!objects.has(path)) throw new EditorAssetError('Uploaded file is missing. Upload it again.', 404); return 'https://storage.test/preview'; },
  async objectExists(path) { return objects.has(path); },
  async expired(before) { return Array.from(rows.values()).filter(a => a.status !== 'verified' && a.expires_at < before); },
  async removeObjects(paths) { paths.forEach(p => objects.delete(p)); },
  async deleteRecords(ids) { ids.forEach(id => rows.delete(id)); },
  async pendingCleanup(before:string) { return Array.from(cleanup).filter(([,after])=>after<before).map(([storage_path])=>({storage_path})); },
  async deleteCleanupRecords(paths:string[]) { paths.forEach(p=>cleanup.delete(p)); },
 };
 let probeResult = photo as typeof photo | typeof video;
 let probeError: Error | null = null;
 const service = createEditorAssetService(repo, async () => { if (probeError) throw probeError; return probeResult; });
 return { service, rows, objects, repo, cleanup, setPro: (value: boolean) => { pro = value; }, setOwner: (value: string) => { clipOwner = value; }, setMissing: () => { missing = true; }, setProbe: (value: typeof photo | typeof video) => { probeResult = value; }, failProbe: () => { probeError = new EditorAssetError('The uploaded file cannot be decoded. Choose a valid photo or video.', 400); } };
}
for (const [name, mime] of [['a.jpg','image/jpeg'],['a.jpeg','image/jpeg'],['a.png','image/png'],['a.webp','image/webp']]) {
 test(`accepts ${mime} at 10 MB and rejects larger declared uploads`, () => {
  assert.equal(validateEditorUpload(name, 10485760, mime).kind, 'photo');
  assert.throws(() => validateEditorUpload(name, 10485761, mime), /10 MB/);
 });
}
for (const [name, mime] of [['a.mp4','video/mp4'],['a.mov','video/quicktime'],['a.webm','video/webm']]) {
 test(`accepts ${mime} at 50 MB and rejects larger declared uploads`, () => {
  assert.equal(validateEditorUpload(name, 52428800, mime).kind, 'video');
  assert.throws(() => validateEditorUpload(name, 52428801, mime), /50 MB/);
 });
}
test('rejects unsupported types, inconsistent extensions, empty and invalid sizes', () => {
 for (const [name, size, mime] of [['x.svg',5,'image/svg+xml'],['x.png',5,'video/mp4'],['x.jpg',0,'image/jpeg'],['x.mp4',NaN,'video/mp4'],['x.png',1.5,'image/png']] as const) assert.throws(() => validateEditorUpload(name,size,mime));
});
test('verified metadata enforces actual size, duration, image/video kind and dimensions', () => {
 assert.deepEqual(validateEditorAssetMetadata(video, 'video'), video);
 for (const metadata of [{...video,duration_ms:60001},{...video,duration_ms:0},{...video,duration_ms:NaN},{...video,size_bytes:52428801},{...video,width:0},{...video,width:99999},{...video,mime_type:'text/html'}]) assert.throws(() => validateEditorAssetMetadata(metadata,'video'));
 assert.throws(() => validateEditorAssetMetadata({...photo,size_bytes:10485761},'photo'));
 assert.throws(() => validateEditorAssetMetadata(photo,'video'));
});
test('upload binds storage path to owner and clip; only a verified asset can get a preview', async () => {
 const f=fixture(); const upload=await f.service.createEditorUpload('user','clip','hello.png',100,'image/png');
 assert.match(upload.asset.storage_path, /^user\/clip\/[a-f0-9-]+\.png$/);
 assert.equal(upload.asset.status,'pending'); assert.equal(upload.upload.token,'signed-token');
 await assert.rejects(f.service.getOwnedEditorAsset('user','clip',upload.asset.id), /verified/i);
 f.objects.add(upload.asset.storage_path);
 const ready=await f.service.finalizeEditorUpload('user','clip',upload.asset.id);
 assert.equal(ready.status,'verified'); assert.equal(ready.width,64);
 assert.equal((await f.service.listEditorAssets('user','clip')).length,1);
 assert.equal((await f.service.previewEditorAsset('user','clip',ready.id)).preview_url,'https://storage.test/preview');
});
test('wrong user, wrong clip and unconfirmed Pro cannot access imports', async () => {
 const f=fixture(); const {asset}=await f.service.createEditorUpload('user','clip','x.png',100,'image/png');
 await assert.rejects(f.service.finalizeEditorUpload('other','clip',asset.id), e=>e instanceof EditorAssetError && e.status===404);
 await assert.rejects(f.service.getOwnedEditorAsset('user','other-clip',asset.id), e=>e instanceof EditorAssetError && e.status===404);
 f.setPro(false); await assert.rejects(f.service.createEditorUpload('user','clip','x.png',100,'image/png'), e=>e instanceof EditorAssetError && e.status===403);
 f.setOwner('other'); await assert.rejects(f.service.listEditorAssets('user','clip'), e=>e instanceof EditorAssetError && e.status===404);
});
test('missing object and invalid bytes never mark an asset verified', async () => {
 const f=fixture(); const {asset}=await f.service.createEditorUpload('user','clip','x.png',100,'image/png');
 await assert.rejects(f.service.finalizeEditorUpload('user','clip',asset.id), /missing/i);
 assert.equal(f.rows.get(asset.id)?.status,'pending');
 f.objects.add(asset.storage_path); f.failProbe();
 await assert.rejects(f.service.finalizeEditorUpload('user','clip',asset.id), /decoded/i);
 assert.equal(f.rows.get(asset.id)?.status,'failed'); assert.equal(f.objects.has(asset.storage_path),false);
});
test('expired pending/failed uploads are removed idempotently after upload-token expiry; verified assets survive', async () => {
 const f=fixture(); const old=await f.service.createEditorUpload('user','clip','old.png',100,'image/png');
 const ready=await f.service.createEditorUpload('user','clip','ready.png',100,'image/png');
 f.objects.add(old.asset.storage_path); f.objects.add(ready.asset.storage_path);
 await f.service.finalizeEditorUpload('user','clip',ready.asset.id);
 assert.ok(Date.parse(old.asset.expires_at)-Date.parse(old.asset.created_at)>=3*3600000);
 f.rows.set(old.asset.id,{...old.asset,expires_at:'2000-01-01T00:00:00.000Z'});
 await f.service.cleanupExpiredUploads(); await f.service.cleanupExpiredUploads();
 assert.equal(f.rows.has(old.asset.id),false); assert.equal(f.objects.has(old.asset.storage_path),false);
 assert.equal(f.rows.has(ready.asset.id),true); assert.equal(f.objects.has(ready.asset.storage_path),true);
});
test('draft validation requires verified owned stored assets and checks usable video duration', async () => {
 const f=fixture(); f.setProbe(video);
 const {asset}=await f.service.createEditorUpload('user','clip','x.mp4',100,'video/mp4'); f.objects.add(asset.storage_path);
 const draft=(id=asset.id,offset=0,end=3000)=>({version:3,cutaways:[{asset_id:id,asset_in_ms:offset,source_start_ms:0,source_end_ms:end}]}) as any;
 await assert.rejects(f.service.assertOwnedDraftAssets('user','clip',draft()),/verified/i);
 await f.service.finalizeEditorUpload('user','clip',asset.id);
 await f.service.assertOwnedDraftAssets('user','clip',draft(asset.id,57000));
 await assert.rejects(f.service.assertOwnedDraftAssets('user','clip',draft(asset.id,58000)),/duration/i);
 await assert.rejects(f.service.assertOwnedDraftAssets('user','clip',draft('other')),/not found/i);
 await assert.rejects(f.service.assertOwnedDraftAssets('user','other',draft()),/not found/i);
 f.objects.clear(); await assert.rejects(f.service.assertOwnedDraftAssets('user','clip',draft()),/missing/i);
 await f.service.assertOwnedDraftAssets('user','clip',{version:2} as any);
});
test('missing migration gives an actionable unavailable error',async()=>{
 const f=fixture(); f.setMissing(); await assert.rejects(f.service.createEditorUpload('user','clip','x.png',100,'image/png'),e=>e instanceof EditorAssetError && e.status===503 && /015_editor_media/.test(e.message));
});
test('malformed MIME metadata is a validation error, including inherited object keys',()=>{
 for(const mime of ['__proto__','constructor','toString',null,{}]) assert.throws(()=>validateEditorUpload('a.png',100,mime as string),e=>e instanceof EditorAssetError && e.status===400);
});
test('storage removal failures preserve expired records so the next sweep can retry',async()=>{
 const f=fixture(); const {asset}=await f.service.createEditorUpload('user','clip','x.png',100,'image/png');
 f.rows.set(asset.id,{...asset,status:'failed',expires_at:'2000-01-01T00:00:00.000Z'}); f.objects.add(asset.storage_path);
 const remove=f.repo.removeObjects; f.repo.removeObjects=async()=>{throw new EditorAssetError('Temporary storage outage',503);};
 await assert.rejects(f.service.cleanupExpiredUploads(),/outage/); assert.equal(f.rows.has(asset.id),true);
 f.repo.removeObjects=remove;await f.service.cleanupExpiredUploads();assert.equal(f.rows.has(asset.id),false);assert.equal(f.objects.size,0);
});
test('verification retries do not re-probe immutable verified files; mismatched actual size fails',async()=>{
 const f=fixture();const {asset}=await f.service.createEditorUpload('user','clip','x.png',101,'image/png');f.objects.add(asset.storage_path);
 await assert.rejects(f.service.finalizeEditorUpload('user','clip',asset.id),/size or format/);assert.equal(f.rows.get(asset.id)?.status,'failed');
 const next=await f.service.createEditorUpload('user','clip','next.png',100,'image/png');f.objects.add(next.asset.storage_path);
 await f.service.finalizeEditorUpload('user','clip',next.asset.id);f.failProbe();
 assert.equal((await f.service.finalizeEditorUpload('user','clip',next.asset.id)).status,'verified');
});
test('a failed concurrent verifier cannot remove an original already verified by another request',async()=>{
 const f=fixture();const {asset}=await f.service.createEditorUpload('user','clip','x.png',100,'image/png');f.objects.add(asset.storage_path);
 let release!:()=>void;const stalled=new Promise<void>(resolve=>{release=resolve;});
 const competing=createEditorAssetService(f.repo,async()=>{await stalled;throw new EditorAssetError('Cannot decode this file',400);});
 const rejected=assert.rejects(competing.finalizeEditorUpload('user','clip',asset.id),/decode/);
 await f.service.finalizeEditorUpload('user','clip',asset.id);release();await rejected;
 assert.equal(f.rows.get(asset.id)?.status,'verified');assert.equal(f.objects.has(asset.storage_path),true);
});
test('malformed draft asset IDs are rejected before a UUID database query',async()=>{
 const f=fixture();f.repo.find=async()=>{throw new Error('invalid input syntax for type uuid');};
 await assert.rejects(f.service.getOwnedEditorAsset('user','clip','not-a-uuid'),error=>error instanceof EditorAssetError && error.status===404);
});
test('retryable verification outages preserve pending uploads and bytes for a later successful retry',async()=>{
 for(const failure of ['binary unavailable','verification timed out','server resource failure']) {
  const f=fixture();const {asset}=await f.service.createEditorUpload('user','clip','x.png',100,'image/png');f.objects.add(asset.storage_path);
  const unavailable=createEditorAssetService(f.repo,async()=>{throw new EditorAssetError(failure,503);});
  await assert.rejects(unavailable.finalizeEditorUpload('user','clip',asset.id),error=>error instanceof EditorAssetError&&error.status===503);
  assert.equal(f.rows.get(asset.id)?.status,'pending');assert.equal(f.objects.has(asset.storage_path),true);
  assert.equal((await f.service.finalizeEditorUpload('user','clip',asset.id)).status,'verified');
 }
});
