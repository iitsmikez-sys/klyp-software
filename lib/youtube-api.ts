import type { YouTubePostDetails } from './youtube-publishing';

export type YouTubeOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };
type Fetcher = typeof fetch;

export class YouTubeUploadError extends Error {
  readonly mayHaveReachedYouTube: boolean;
  readonly videoId: string | null;
  constructor(message: string, mayHaveReachedYouTube: boolean, videoId: string | null = null) {
    super(message);
    this.mayHaveReachedYouTube = mayHaveReachedYouTube;
    this.videoId = videoId;
  }
}

export function youtubeConsentUrl(config: YouTubeOAuthConfig, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/youtube.upload',
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(params: URLSearchParams, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`YouTube authorization failed (HTTP ${response.status}). Reconnect your channel.`);
  return await response.json() as Record<string, unknown>;
}

export async function exchangeYouTubeCode(config: YouTubeOAuthConfig, code: string, fetcher: Fetcher = fetch):
  Promise<{ accessToken: string; refreshToken: string }> {
  const data = await tokenRequest(new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret,
    redirect_uri: config.redirectUri, grant_type: 'authorization_code', code,
  }), fetcher);
  if (typeof data.access_token !== 'string') throw new Error('YouTube did not return an access token.');
  if (typeof data.refresh_token !== 'string') throw new Error('YouTube did not return a refresh token. Reconnect your channel.');
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function refreshYouTubeAccessToken(config: YouTubeOAuthConfig, refreshToken: string,
  fetcher: Fetcher = fetch): Promise<string> {
  const data = await tokenRequest(new URLSearchParams({
    client_id: config.clientId, client_secret: config.clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  }), fetcher);
  if (typeof data.access_token !== 'string') throw new Error('YouTube did not return an access token.');
  return data.access_token;
}

/** Revoke the stored grant before removing Klyp's copy of the refresh token. */
export async function revokeYouTubeToken(refreshToken: string, fetcher: Fetcher = fetch): Promise<void> {
  const response = await fetcher('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken }),
    cache: 'no-store',
  });
  // Google returns invalid_token when a grant was already revoked elsewhere.
  if (response.ok || response.status === 400) return;
  throw new Error(`Google could not disconnect this YouTube account (HTTP ${response.status}). Try again.`);
}

/** Uploads a rendered clip once. Ambiguous outcomes are not automatically retried. */
export async function uploadToYouTube(input: YouTubePostDetails & { accessToken: string; bytes: Buffer },
  fetcher: Fetcher = fetch): Promise<string> {
  if (!input.publishAt) throw new YouTubeUploadError('Choose a date and time to schedule this clip.', false);
  const metadata = {
    snippet: { title: input.title, description: input.description },
    status: { privacyStatus: 'private', publishAt: input.publishAt },
  };
  const start = await fetcher('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(input.bytes.byteLength),
    },
    body: JSON.stringify(metadata),
    cache: 'no-store',
  });
  if (!start.ok) throw new YouTubeUploadError(`YouTube rejected the upload (HTTP ${start.status}).`, false);
  const location = start.headers.get('location');
  let uploadUrl: URL;
  try { uploadUrl = new URL(location ?? ''); } catch { throw new YouTubeUploadError('YouTube returned an invalid upload session.', false); }
  if (uploadUrl.protocol !== 'https:' || uploadUrl.hostname !== 'www.googleapis.com' ||
    !uploadUrl.pathname.startsWith('/upload/youtube/v3/videos')) {
    throw new YouTubeUploadError('YouTube returned an invalid upload session.', false);
  }
  try {
    const uploaded = await fetcher(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'video/mp4',
        'Content-Length': String(input.bytes.byteLength) },
      body: input.bytes as unknown as BodyInit,
      cache: 'no-store',
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!uploaded.ok) throw new Error(`YouTube upload failed (HTTP ${uploaded.status}). Check your channel before retrying.`);
    const data = await uploaded.json() as { id?: unknown };
    if (typeof data.id !== 'string' || !data.id) throw new Error('YouTube did not confirm a video ID. Check your channel before retrying.');
    if (input.publishAt && Date.parse(input.publishAt) < Date.now() + 5 * 60_000) {
      throw new YouTubeUploadError('YouTube accepted the video too close to its scheduled time. Check its visibility on YouTube.', true, data.id);
    }
    return data.id;
  } catch (error) {
    if (error instanceof YouTubeUploadError) throw error;
    throw new YouTubeUploadError(error instanceof Error ? error.message : 'YouTube upload did not complete.', true);
  }
}
