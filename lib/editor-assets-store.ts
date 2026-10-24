import { createAdminClient } from './supabase/admin.ts';
import { EDITOR_MEDIA_BUCKET, EDITOR_PREVIEW_SECONDS, EditorAssetError, type EditorAsset, type EditorAssetRepository } from './editor-assets.ts';

/** Translate missing deployment prerequisites without leaking storage or database internals. */
export function editorAssetStoreError(error: { code?: string; message?: string; statusCode?: string | number }): EditorAssetError {
 if (['42P01','42703','PGRST205','PGRST204'].includes(error.code || '') || /bucket.*not found|relation.*does not exist|schema cache/i.test(error.message || '')) return new EditorAssetError('Editor media is unavailable. Apply Supabase migration 023_editor_media.sql to create its private bucket and table.', 503);
 return new EditorAssetError('Editor media storage is temporarily unavailable. Please try again.', 503);
}

export function editorAssetRepository(): EditorAssetRepository {
 const admin = createAdminClient();
 const bucket = admin.storage.from(EDITOR_MEDIA_BUCKET);
 const table = () => admin.from('editor_assets');
 const check = (error: {code?:string;message?:string;statusCode?:string|number} | null) => { if(error) throw editorAssetStoreError(error); };
 return {
  async access(userId,clipId) {
   const [clip,profile] = await Promise.all([
    admin.from('clips').select('user_id').eq('id',clipId).eq('user_id',userId).maybeSingle(),
    admin.from('profiles').select('tier,stripe_subscription_id').eq('id',userId).maybeSingle(),
   ]);
   check(clip.error); check(profile.error);
   return {owner:clip.data?.user_id ?? null,tier:profile.data?.tier ?? null,subscription:profile.data?.stripe_subscription_id ?? null};
  },
  async insert(asset) { const {error}=await table().insert(asset); check(error); },
  async find(userId,clipId,assetId) {
   const {data,error}=await table().select('*').eq('id',assetId).eq('user_id',userId).eq('clip_id',clipId).maybeSingle(); check(error); return data as EditorAsset | null;
  },
  async list(userId,clipId) {
   const assets:EditorAsset[]=[];
   for(let offset=0;;offset+=200) {
    const {data,error}=await table().select('*').eq('user_id',userId).eq('clip_id',clipId).eq('status','verified').order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+199); check(error);
    assets.push(...data as EditorAsset[]);
    if(data!.length<200) return Array.from(new Map(assets.map(a=>[a.id,a])).values());
   }
  },
  async verify(asset,metadata) {
   const {data,error}=await table().update({...metadata,status:'verified',verified_at:new Date().toISOString()}).eq('id',asset.id).eq('user_id',asset.user_id).eq('clip_id',asset.clip_id).eq('status','pending').select('*').maybeSingle(); check(error);
   if(data) return data as EditorAsset;
   // Two retries may have verified the same immutable object concurrently.
   const existing=await this.find(asset.user_id,asset.clip_id,asset.id);
   if(existing?.status==='verified') return existing;
   throw new EditorAssetError('This upload expired or failed verification. Upload the file again.',409);
  },
  async fail(asset) {
   const {data,error}=await table().update({status:'failed'}).eq('id',asset.id).eq('user_id',asset.user_id).eq('clip_id',asset.clip_id).eq('status','pending').select('id').maybeSingle(); check(error); return !!data;
  },
  async signUpload(path) { const {data,error}=await bucket.createSignedUploadUrl(path,{upsert:false}); check(error); return data!; },
  async signPreview(path) { const {data,error}=await bucket.createSignedUrl(path,EDITOR_PREVIEW_SECONDS); check(error); return data!.signedUrl; },
  async objectExists(path) {
   const {error}=await bucket.info(path);
   if(error && /bucket.*not found/i.test(error.message)) throw editorAssetStoreError(error);
   if(error && (String(error.statusCode)==='404' || /object not found/i.test(error.message))) return false;
   check(error); return true;
  },
  async expired(before) { const {data,error}=await table().select('*').neq('status','verified').lt('expires_at',before).order('expires_at').limit(100); check(error); return data as EditorAsset[]; },
  async removeObjects(paths) { const {error}=await bucket.remove(paths); check(error); },
  async deleteRecords(ids) { const {error}=await table().delete().in('id',ids).neq('status','verified'); check(error); },
  async pendingCleanup(before) { const {data,error}=await admin.from('editor_asset_cleanup').select('storage_path').lt('not_before',before).order('not_before').limit(100); check(error); return data!; },
  async deleteCleanupRecords(paths) { const {error}=await admin.from('editor_asset_cleanup').delete().in('storage_path',paths); check(error); },
 };
}
