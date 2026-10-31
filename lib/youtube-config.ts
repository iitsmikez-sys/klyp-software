import type { YouTubeOAuthConfig } from './youtube-api';

export function youtubeConfig(): YouTubeOAuthConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri || !redirectUri.startsWith('https://') && !redirectUri.startsWith('http://localhost:')) {
    throw new Error('YouTube connection is not configured.');
  }
  return { clientId, clientSecret, redirectUri };
}

export function youtubeTokenKey(): string {
  const key = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('YouTube token encryption is not configured.');
  return key;
}
