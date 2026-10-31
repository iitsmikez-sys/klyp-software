/** Browser-side multipart upload. No Cloudflare credential is sent to this code. */
type Api = (path: string, init?: RequestInit) => Promise<Response>;
type Put = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok'>>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Result = { uploadId: string; durationSeconds: number; sparks: number };

async function apiJson(api: Api, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await api(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== 'object') {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Upload connection failed.');
  }
  return data;
}

const post = (api: Api, action: string, fields: object) => apiJson(api, '/api/upload/r2', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, ...fields }),
});

/** Re-select the same file to resume after reload; the browser cannot retain
 * arbitrary local file access itself. Server-side ListParts is authoritative. */
export async function uploadFileToR2(file: File, api: Api, put: Put, storage: Storage,
  onProgress: (pct: number) => void): Promise<Result> {
  const cacheKey = `klyp-r2-upload:${file.name}:${file.size}:${file.lastModified}`;
  let id = storage.getItem(cacheKey);
  let session: Record<string, unknown> | null = null;
  if (id) {
    const response = await api(`/api/upload/r2?uploadId=${encodeURIComponent(id)}`);
    if (response.status === 404 || response.status === 410) {
      storage.removeItem(cacheKey);
      id = null;
    } else {
      if (!response.ok) throw new Error('Could not resume the upload.');
      session = await response.json();
      if (session?.status !== 'ready' &&
          (session?.expectedBytes !== file.size || session?.fileName !== file.name)) {
        storage.removeItem(cacheKey);
        id = null;
        session = null;
      }
    }
  }
  if (session?.status === 'ready' && id) {
    storage.removeItem(cacheKey);
    return { uploadId: id, durationSeconds: Number(session.durationSeconds), sparks: Number(session.sparks) };
  }
  if (!id || !session) {
    session = await post(api, 'start', { fileName: file.name, bytes: file.size });
    id = String(session.id);
    storage.setItem(cacheKey, id);
  }
  const partBytes = Number(session.partBytes);
  const count = Math.ceil(file.size / partBytes);
  if (!Number.isSafeInteger(partBytes) || partBytes < 1 ||
      !Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    throw new Error('Invalid upload session.');
  }
  const done = new Set<number>(Array.isArray(session.completedParts)
    ? session.completedParts.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count) : []);
  let completedBytes = [...done].reduce((total, n) =>
    total + Math.max(0, Math.min(partBytes, file.size - (n - 1) * partBytes)), 0);
  onProgress(Math.round(completedBytes / file.size * 100));
  for (let part = 1; part <= count; part++) {
    if (done.has(part)) continue;
    const { url } = await post(api, 'part', { uploadId: id, partNumber: part });
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Invalid upload URL.');
    const start = (part - 1) * partBytes;
    const end = Math.min(file.size, start + partBytes);
    const response = await put(url, { method: 'PUT', body: file.slice(start, end) });
    if (!response.ok) throw new Error(`Upload paused at part ${part}. Select the same file to resume.`);
    completedBytes += end - start;
    onProgress(Math.round(completedBytes / file.size * 100));
  }
  const result = await post(api, 'finish', { uploadId: id });
  if (result.uploadId !== id || !Number.isFinite(result.durationSeconds) ||
      !Number.isFinite(result.sparks)) throw new Error('Upload could not be verified.');
  storage.removeItem(cacheKey);
  return { uploadId: id, durationSeconds: Number(result.durationSeconds), sparks: Number(result.sparks) };
}
