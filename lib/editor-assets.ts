import type { ClipEditDraft } from './clip-edit-draft.ts';
import { randomUUID } from 'node:crypto';
import { authorizeClipDraftWrite } from './clip-edit-auth.ts';

export const EDITOR_MEDIA_BUCKET = 'editor-media';
export const EDITOR_PREVIEW_SECONDS = 300;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

export type EditorAssetMetadata = { kind: 'photo' | 'video'; mime_type: string; size_bytes: number; width: number; height: number; duration_ms: number | null };
export type EditorAsset = {
 id: string; user_id: string; clip_id: string; storage_path: string; file_name: string;
 kind: 'photo' | 'video'; declared_size: number; declared_mime: string;
 status: 'pending' | 'verified' | 'failed'; created_at: string; expires_at: string; verified_at: string | null;
 mime_type: string | null; size_bytes: number | null; width: number | null; height: number | null; duration_ms: number | null;
};
export type EditorAssetRepository = {
 access(userId: string, clipId: string): Promise<{ owner: string | null; tier: string | null; subscription: string | null }>;
 insert(asset: EditorAsset): Promise<void>;
 find(userId: string, clipId: string, assetId: string): Promise<EditorAsset | null>;
 list(userId: string, clipId: string): Promise<EditorAsset[]>;
 verify(asset: EditorAsset, metadata: EditorAssetMetadata): Promise<EditorAsset>;
 fail(asset: EditorAsset): Promise<boolean>;
 signUpload(path: string): Promise<{ signedUrl: string; token: string; path: string }>;
 signPreview(path: string): Promise<string>;
 objectExists(path: string): Promise<boolean>;
 expired(before: string): Promise<EditorAsset[]>;
 removeObjects(paths: string[]): Promise<void>;
 deleteRecords(ids: string[]): Promise<void>;
 pendingCleanup(before: string): Promise<{storage_path:string}[]>;
 deleteCleanupRecords(paths: string[]): Promise<void>;
};
export class EditorAssetError extends Error {
 readonly status: number;
 constructor(message: string, status = 400) { super(message); this.name = 'EditorAssetError'; this.status = status; }
}
const formats: Record<string, { kind: 'photo'|'video'; extensions: string[] }> = {
 'image/jpeg': { kind: 'photo', extensions: ['jpg','jpeg'] },
 'image/png': { kind: 'photo', extensions: ['png'] },
 'image/webp': { kind: 'photo', extensions: ['webp'] },
 'video/mp4': { kind: 'video', extensions: ['mp4'] },
 'video/quicktime': { kind: 'video', extensions: ['mov'] },
 'video/webm': { kind: 'video', extensions: ['webm'] },
};
export function validateEditorUpload(fileName: string, size: number, mime: string): {kind:'photo'|'video'; extension:string} {
 const format = typeof mime === 'string' && Object.hasOwn(formats,mime) ? formats[mime] : undefined;
 const extension = typeof fileName === 'string' ? fileName.split('.').pop()?.toLowerCase() : undefined;
 if (!format || !extension || !format.extensions.includes(extension) || fileName.length > 255 || /[\x00-\x1f]/.test(fileName)) throw new EditorAssetError('Choose a JPEG, PNG, WebP, MP4, MOV, or WebM file with a matching file type.');
 if (!Number.isSafeInteger(size) || size <= 0) throw new EditorAssetError('The uploaded file must not be empty.');
 if (size > (format.kind === 'photo' ? PHOTO_MAX_BYTES : VIDEO_MAX_BYTES)) throw new EditorAssetError(format.kind === 'photo' ? 'Photos must be 10 MB or smaller.' : 'Videos must be 50 MB or smaller.', 413);
 return { kind: format.kind, extension };
}
export function validateEditorAssetMetadata(metadata: EditorAssetMetadata, kind: 'photo'|'video'): EditorAssetMetadata {
 if (metadata.kind !== kind || formats[metadata.mime_type]?.kind !== kind) throw new EditorAssetError('The actual media format does not match the upload.');
 validateEditorUpload(`media.${formats[metadata.mime_type].extensions[0]}`, metadata.size_bytes, metadata.mime_type);
 if (![metadata.width, metadata.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || metadata.width * metadata.height > 33554432) throw new EditorAssetError('Media dimensions must be at most 8192 pixels per side and 32 megapixels.');
 if (kind === 'video' && (!Number.isFinite(metadata.duration_ms) || metadata.duration_ms! <= 0 || metadata.duration_ms! > 60000)) throw new EditorAssetError('Videos must have a readable duration of 60 seconds or less.');
 if (kind === 'photo' && metadata.duration_ms !== null) throw new EditorAssetError('Choose a still photo; animated images are not supported.');
 return metadata;
}
export function createEditorAssetService(repo: EditorAssetRepository, probe: (asset: EditorAsset) => Promise<EditorAssetMetadata>) {
 async function authorize(userId:string, clipId:string) {
  const access = await repo.access(userId, clipId);
  const denial = authorizeClipDraftWrite(userId, access.owner, access.tier, access.subscription);
  if (denial) throw new EditorAssetError(denial === 404 ? 'Clip not found.' : 'Importing media requires a confirmed Pro subscription.', denial);
 }
 async function owned(userId:string, clipId:string, assetId:string) {
  await authorize(userId, clipId);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(assetId)) throw new EditorAssetError('Media asset not found.', 404);
  const asset = await repo.find(userId, clipId, assetId);
  if (!asset || asset.user_id !== userId || asset.clip_id !== clipId) throw new EditorAssetError('Media asset not found.', 404);
  return asset;
 }
 async function exists(asset:EditorAsset) {
  if (!await repo.objectExists(asset.storage_path)) throw new EditorAssetError('The uploaded file is missing. Upload it again.', 404);
 }
 async function getOwnedEditorAsset(userId:string,clipId:string,assetId:string):Promise<EditorAsset> {
  const asset = await owned(userId,clipId,assetId);
  if (asset.status !== 'verified') throw new EditorAssetError('This media asset has not been verified. Finish uploading it first.', 409);
  await exists(asset);
  return asset;
 }
 return {
  async createEditorUpload(userId: string, clipId: string, fileName: string, size: number, mime: string) {
   await authorize(userId, clipId);
   const { kind, extension } = validateEditorUpload(fileName, size, mime);
   const id = randomUUID(), now = Date.now();
   const asset: EditorAsset = { id, user_id:userId, clip_id:clipId, storage_path:`${userId}/${clipId}/${id}.${extension}`, file_name:fileName.split(/[\\/]/).pop()!, kind, declared_size:size, declared_mime:mime, status:'pending', created_at:new Date(now).toISOString(), expires_at:new Date(now + 3*3600000).toISOString(), verified_at:null, mime_type:null, size_bytes:null, width:null, height:null, duration_ms:null };
   await repo.insert(asset);
   // Supabase upload tokens expire after two hours. Never enable upsert: verified originals are immutable.
   const upload = await repo.signUpload(asset.storage_path);
   return { asset, upload };
  },
  async finalizeEditorUpload(userId:string,clipId:string,assetId:string):Promise<EditorAsset> {
   const asset = await owned(userId,clipId,assetId);
   if (asset.status === 'verified') { await exists(asset); return asset; }
   if (asset.status === 'failed') throw new EditorAssetError('This upload failed verification. Choose the file and upload it again.', 409);
   // Leave more than the bounded probe/download time before cleanup can remove the row.
   if (Date.parse(asset.expires_at) - Date.now() < 180000) throw new EditorAssetError('This upload has expired. Upload the file again.', 410);
   await exists(asset);
   try {
    const metadata = validateEditorAssetMetadata(await probe(asset), asset.kind);
    if (metadata.size_bytes !== asset.declared_size || metadata.mime_type !== asset.declared_mime) throw new EditorAssetError('The stored file does not match the declared size or format. Upload it again.');
    return await repo.verify(asset, metadata);
   } catch (error) {
    // Retain the failed row until the upload token expires, so replayed uploads are swept too.
    // Transient infrastructure errors remain retryable; only invalid media is terminal.
    if (error instanceof EditorAssetError && error.status < 500) {
     const markedFailed = await repo.fail(asset);
     if (markedFailed) {
      try { await repo.removeObjects([asset.storage_path]); } catch (cleanupError) { console.error('[editor-media] failed upload cleanup will retry', cleanupError); }
     }
    }
    throw error;
   }
  },
  getOwnedEditorAsset,
  async listEditorAssets(userId:string,clipId:string):Promise<EditorAsset[]> { await authorize(userId,clipId); return repo.list(userId,clipId); },
  async previewEditorAsset(userId:string,clipId:string,assetId:string) {
   const asset = await getOwnedEditorAsset(userId,clipId,assetId);
   return { asset, preview_url: await repo.signPreview(asset.storage_path), expires_in: EDITOR_PREVIEW_SECONDS };
  },
  async assertOwnedDraftAssets(userId:string,clipId:string,draft:ClipEditDraft):Promise<void> {
   if (draft.version !== 3 || !draft.cutaways.length) return;
   const assets = new Map<string,EditorAsset>();
   for (const cutaway of draft.cutaways) {
    let asset = assets.get(cutaway.asset_id);
    if (!asset) { asset = await getOwnedEditorAsset(userId,clipId,cutaway.asset_id); assets.set(asset.id,asset); }
    if (asset.kind === 'video' && (asset.duration_ms === null || cutaway.asset_in_ms + cutaway.source_end_ms - cutaway.source_start_ms > asset.duration_ms)) throw new EditorAssetError('The cutaway extends beyond the imported video duration. Shorten it or choose a different video.');
    if (asset.kind === 'photo' && cutaway.asset_in_ms !== 0) throw new EditorAssetError('A photo cutaway must start at media offset zero.');
   }
  },
  async cleanupExpiredUploads():Promise<void> {
   const now=new Date().toISOString();
   // Drain deletion manifests even when an abandoned upload batch is failing.
   // Independent of clip/account FKs: direct DB cascades use the same durable queue.
   const queued=await repo.pendingCleanup(now);
   if(queued.length) {
    const paths=queued.map(a=>a.storage_path);
    await repo.removeObjects(paths);
    await repo.deleteCleanupRecords(paths);
   }
   const expired = await repo.expired(now);
   if(expired.length) {
    await repo.removeObjects(expired.map(a=>a.storage_path));
    await repo.deleteRecords(expired.map(a=>a.id));
   }
  },
 };
}

async function service() {
 const { editorAssetRepository } = await import('./editor-assets-store.ts');
 return createEditorAssetService(editorAssetRepository(), async asset => {
  const { probeStoredEditorAsset } = await import('./editor-asset-probe.ts');
  return probeStoredEditorAsset(asset);
 });
}
export async function createEditorUpload(userId:string,clipId:string,fileName:string,declaredSize:number,declaredMime:string) { return (await service()).createEditorUpload(userId,clipId,fileName,declaredSize,declaredMime); }
export async function finalizeEditorUpload(userId:string,clipId:string,assetId:string) { return (await service()).finalizeEditorUpload(userId,clipId,assetId); }
export async function listEditorAssets(userId:string,clipId:string) { return (await service()).listEditorAssets(userId,clipId); }
export async function getOwnedEditorAsset(userId:string,clipId:string,assetId:string) { return (await service()).getOwnedEditorAsset(userId,clipId,assetId); }
export async function previewEditorAsset(userId:string,clipId:string,assetId:string) { return (await service()).previewEditorAsset(userId,clipId,assetId); }
export async function assertOwnedDraftAssets(userId:string,clipId:string,draft:ClipEditDraft) { if(draft.version===3 && draft.cutaways.length) await (await service()).assertOwnedDraftAssets(userId,clipId,draft); }
export async function cleanupExpiredEditorUploads() { return (await service()).cleanupExpiredUploads(); }
