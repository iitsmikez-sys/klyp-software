/** Opt-in direct multipart upload control plane; video bytes go browser → R2. */
import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getProfileFromToken } from '@/lib/profile-token';
import { corsPreflight, withCors } from '@/lib/cors';
import { resolveBin, runCapture } from '@/lib/bin';
import { estimateSparks } from '@/lib/sparks';
import { r2Storage } from '@/lib/r2';
import { beginR2Upload, finishR2Upload, R2_PART_BYTES, signR2UploadPart } from '@/lib/r2-upload-flow';
import { r2UploadRepository } from '@/lib/r2-upload-store';
import { recordR2UsageEvent } from '@/lib/r2-usage';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const OPTIONS = corsPreflight;

function respond(body: object, status = 200): Response {
  return withCors(NextResponse.json(body, { status }));
}

export async function GET(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== 'processing') return respond({ enabled: false }, 404);
  let r2;
  try { r2 = process.env.R2_WRITES_ENABLED === '1' ? r2Storage() : null; }
  catch { return respond({ error: 'Upload storage is unavailable.' }, 503); }
  if (process.env.R2_WRITES_ENABLED === '1' && !r2) {
    return respond({ error: 'Upload storage is unavailable.' }, 503);
  }
  if (!r2) return respond({ enabled: false });
  const id = new URL(req.url).searchParams.get('uploadId');
  if (!id) return respond({ enabled: true, partBytes: R2_PART_BYTES });
  const token = bearerToken(req);
  const profile = token ? await getProfileFromToken(token) : null;
  if (!profile) return respond({ error: 'Sign in to resume an upload.' }, 401);
  const row = await r2UploadRepository.get(id);
  if (!row || row.userId !== profile.id) return respond({ error: 'Upload not found.' }, 404);
  if (row.status === 'expired') return respond({ error: 'Upload session expired.' }, 410);
  if (row.status === 'ready') return respond({ enabled: true, uploadId: id,
    status: row.status, durationSeconds: row.durationSeconds,
    sparks: estimateSparks(row.durationSeconds!) });
  if (Date.parse(row.expiresAt) <= Date.now()) return respond({ error: 'Upload session expired.' }, 410);
  const parts = await r2.listParts(row.key, row.remoteId);
  return respond({ enabled: true, uploadId: id, status: row.status,
    fileName: row.filename, expectedBytes: row.expectedBytes,
    partBytes: R2_PART_BYTES, completedParts: parts.map(p => p.partNumber) });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (process.env.DEPLOYMENT_TARGET !== 'processing') return respond({ error: 'Unavailable.' }, 404);
  let r2;
  try { r2 = process.env.R2_WRITES_ENABLED === '1' ? r2Storage() : null; }
  catch { return respond({ error: 'R2 is not configured on the processing service.' }, 503); }
  if (!r2) return respond({ error: 'R2 uploads are not enabled.' }, 404);
  const token = bearerToken(req);
  const profile = token ? await getProfileFromToken(token) : null;
  if (!profile) return respond({ error: 'Sign in to upload a VOD.' }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return respond({ error: 'Invalid upload request.' }, 400); }
  try {
    switch (body.action) {
      case 'start': {
        const result = await beginR2Upload(profile.id, String(body.fileName ?? ''),
          Number(body.bytes), r2UploadRepository, r2);
        return respond(result);
      }
      case 'part': {
        const url = await signR2UploadPart(profile.id, String(body.uploadId ?? ''),
          Number(body.partNumber), r2UploadRepository, r2);
        return respond({ url });
      }
      case 'finish': {
        const result = await finishR2Upload(profile.id, String(body.uploadId ?? ''),
          r2UploadRepository, r2, async signedUrl => {
            const output = await runCapture(resolveBin('ffprobe'), [
              '-v', 'error', '-show_entries', 'format=duration',
              '-of', 'default=noprint_wrappers=1:nokey=1', signedUrl,
            ], { maxRunMs: 60_000 });
            return Number(output.trim());
          });
        const row = await r2UploadRepository.get(result.uploadId);
        if (!row || row.userId !== profile.id) throw new Error('Verified upload was not found.');
        await recordR2UsageEvent({ eventKey: `vod:${row.id}:upload`, userId: profile.id,
          objectKey: row.key, operation: 'vod_upload', bytes: row.expectedBytes,
          requestCount: Math.ceil(row.expectedBytes / R2_PART_BYTES) });
        return respond({ ...result, sparks: estimateSparks(result.durationSeconds) });
      }
      default:
        return respond({ error: 'Unknown upload action.' }, 400);
    }
  } catch (error) {
    // Never echo provider errors: they may contain a signed URL or account ID.
    console.error('[r2-upload]', body.action, error instanceof Error ? error.name : 'error');
    return respond({ error: 'Upload could not be completed. Please retry or choose the file again.' }, 503);
  }
}
