import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_MS = 120_000;

/** Authenticate a processing job to the web service without exposing Google credentials to the worker. */
export function signWorkerTokenRequest(postId: string, timestamp: string, sharedSecret: string): string {
  return createHmac('sha256', sharedSecret).update(`youtube-worker-token:v1:${postId}:${timestamp}`).digest('hex');
}

export function verifyWorkerTokenRequest(postId: string, timestamp: string, signature: string,
  sharedSecret: string, now = Date.now()): boolean {
  if (!UUID.test(postId) || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature) || !sharedSecret) return false;
  if (Math.abs(now - Number(timestamp)) > WINDOW_MS) return false;
  const expected = Buffer.from(signWorkerTokenRequest(postId, timestamp, sharedSecret), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function workerTokenEndpoint(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('Invalid YouTube callback origin.');
  }
  return new URL('/api/youtube/worker-token', url.origin).toString();
}

export async function requestWorkerAccessToken(postId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const secret = process.env.YOUTUBE_WORKER_SIGNING_KEY;
  const callback = process.env.YOUTUBE_REDIRECT_URI;
  if (!secret || !callback) throw new Error('YouTube publishing is not configured.');
  const timestamp = String(Date.now());
  const response = await fetcher(workerTokenEndpoint(callback), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-klyp-token-timestamp': timestamp,
      'x-klyp-token-signature': signWorkerTokenRequest(postId, timestamp, secret),
    },
    body: JSON.stringify({ postId }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('YouTube authorization failed. Try again after checking the channel connection.');
  const data = await response.json() as { accessToken?: unknown };
  if (typeof data.accessToken !== 'string' || !data.accessToken) throw new Error('YouTube authorization did not return an access token.');
  return data.accessToken;
}
