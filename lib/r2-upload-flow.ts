import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { r2ObjectKey } from './r2-config.ts';
import type { R2ListedPart, R2Object, R2Part } from './r2.ts';

export const R2_PART_BYTES = 16 * 1024 * 1024;
export const R2_MAX_VOD_BYTES = 4 * 1024 * 1024 * 1024;
const allowed = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const mime: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.m4v': 'video/x-m4v' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VodUpload = {
  id: string; userId: string; key: string; remoteId: string; filename: string;
  expectedBytes: number; status: 'uploading' | 'ready' | 'expired';
  durationSeconds: number | null; expiresAt: string;
};
export type VodUploadRepository = {
  insert(row: VodUpload): Promise<void>;
  get(id: string): Promise<VodUpload | null>;
  markReady(id: string, durationSeconds: number): Promise<void>;
};
export type VodUploadStorage = {
  createMultipart(key: string, contentType: string): Promise<string>;
  signPart(key: string, remoteId: string, partNumber: number): Promise<string>;
  listParts(key: string, remoteId: string): Promise<R2ListedPart[]>;
  complete(key: string, remoteId: string, parts: R2Part[]): Promise<void>;
  head(key: string): Promise<R2Object | null>;
  signedGet(key: string): Promise<string>;
  abort(key: string, remoteId: string): Promise<void>;
};

function owned(row: VodUpload | null, userId: string): VodUpload {
  if (!row || row.userId !== userId || row.status === 'expired') throw new Error('Upload not found.');
  return row;
}

export async function beginR2Upload(userId: string, filename: string, bytes: number,
  repo: VodUploadRepository, r2: VodUploadStorage): Promise<{ id: string; partBytes: number; parts: number }> {
  const ext = path.extname(filename).toLowerCase();
  if (!uuid.test(userId) || !allowed.has(ext) || !Number.isSafeInteger(bytes) ||
      bytes < 1 || bytes > R2_MAX_VOD_BYTES) throw new Error('Invalid VOD upload.');
  const id = randomUUID();
  const key = r2ObjectKey('vod', userId, id, `source${ext}`);
  const remoteId = await r2.createMultipart(key, mime[ext]);
  try {
    await repo.insert({ id, userId, key, remoteId, filename: filename.slice(0, 255),
      expectedBytes: bytes, status: 'uploading', durationSeconds: null,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() });
  } catch (error) {
    await r2.abort(key, remoteId).catch(() => {});
    throw error;
  }
  return { id, partBytes: R2_PART_BYTES, parts: Math.ceil(bytes / R2_PART_BYTES) };
}

export async function signR2UploadPart(userId: string, id: string, partNumber: number,
  repo: VodUploadRepository, r2: VodUploadStorage): Promise<string> {
  const row = owned(await repo.get(id), userId);
  if (row.status !== 'uploading' || Date.parse(row.expiresAt) <= Date.now() ||
      !Number.isInteger(partNumber) || partNumber < 1 ||
      partNumber > Math.ceil(row.expectedBytes / R2_PART_BYTES)) {
    throw new Error('Upload part is unavailable.');
  }
  return r2.signPart(row.key, row.remoteId, partNumber);
}

export async function finishR2Upload(userId: string, id: string,
  repo: VodUploadRepository, r2: VodUploadStorage,
  probe: (signedUrl: string) => Promise<number>): Promise<{ uploadId: string; durationSeconds: number }> {
  const row = owned(await repo.get(id), userId);
  if (row.status === 'ready' && row.durationSeconds) {
    return { uploadId: id, durationSeconds: row.durationSeconds };
  }
  if (row.status !== 'uploading' || Date.parse(row.expiresAt) <= Date.now()) {
    throw new Error('Upload session expired.');
  }
  let confirmed = await r2.head(row.key);
  if (!confirmed) {
    const parts = await r2.listParts(row.key, row.remoteId);
    const expectedParts = Math.ceil(row.expectedBytes / R2_PART_BYTES);
    if (parts.length !== expectedParts || parts.some((part, i) =>
        part.partNumber !== i + 1 || part.bytes !== Math.min(R2_PART_BYTES,
          row.expectedBytes - i * R2_PART_BYTES))) {
      throw new Error('VOD upload is incomplete.');
    }
    try { await r2.complete(row.key, row.remoteId, parts); }
    catch (error) {
      // Another finish request may have completed the same multipart upload.
      // Only accept that race after an independent HEAD byte check below.
      const raced = await r2.head(row.key);
      if (!raced || raced.bytes !== row.expectedBytes) throw error;
    }
    confirmed = await r2.head(row.key);
  }
  if (!confirmed || confirmed.bytes !== row.expectedBytes) {
    throw new Error('VOD upload size could not be verified.');
  }
  const durationSeconds = Math.round(await probe(await r2.signedGet(row.key)));
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0 || durationSeconds > 10 * 3600) {
    throw new Error('VOD duration is unavailable or exceeds 10 hours.');
  }
  try { await repo.markReady(id, durationSeconds); }
  catch (error) {
    const finalized = await repo.get(id);
    if (finalized?.status !== 'ready' || finalized.durationSeconds !== durationSeconds) throw error;
  }
  return { uploadId: id, durationSeconds };
}
