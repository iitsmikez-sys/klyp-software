import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { hasProAccess, type Profile } from './tier.ts';

type Subscription = Pick<Profile, 'tier' | 'stripe_subscription_id' | 'complimentary_pro'>;

export function isConfirmedPro(profile: Subscription | null | undefined): boolean {
  return !!profile && hasProAccess(profile);
}

export function canRetryUncertainPost(post: {
  status: string; youtube_video_id: string | null; created_at: string;
}, now = Date.now()): boolean {
  const created = Date.parse(post.created_at);
  return (post.status === 'processing' || post.status === 'needs_review') &&
    !post.youtube_video_id && Number.isFinite(created) && created <= now - 60 * 60_000;
}

export type YouTubePostDetails = {
  title: string;
  description: string;
  publishAt: string | null;
  privacyStatus: 'public' | 'private' | 'unlisted';
};

/** YouTube's native scheduler requires a future time on a private upload. */
export function validateYouTubePost(input: {
  title: unknown; description: unknown; publishAt?: unknown; privacyStatus?: unknown;
}, now = Date.now()): YouTubePostDetails {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!title || title.length > 100 || /[<>]/.test(title)) throw new Error('Enter a YouTube title under 100 characters.');
  if (description.length > 5000) throw new Error('YouTube description must be under 5,000 characters.');
  const privacyStatus = input.privacyStatus === undefined ? 'public' : input.privacyStatus;
  if (privacyStatus !== 'public' && privacyStatus !== 'private' && privacyStatus !== 'unlisted') {
    throw new Error('Choose a valid YouTube privacy setting.');
  }
  let publishAt: string | null = null;
  if (input.publishAt !== null && input.publishAt !== undefined && input.publishAt !== '') {
    if (typeof input.publishAt !== 'string' || !Number.isFinite(Date.parse(input.publishAt))) {
      throw new Error('Choose a valid schedule date.');
    }
    const time = Date.parse(input.publishAt);
    if (time < now + 30 * 60_000) throw new Error('Schedule at least 30 minutes in the future.');
    publishAt = new Date(time).toISOString();
  }
  if (!publishAt) throw new Error('Choose a date and time to schedule this clip.');
  if (publishAt && privacyStatus !== 'public') throw new Error('Scheduled videos publish publicly; choose Public visibility.');
  return { title, description, publishAt, privacyStatus };
}

function encryptionKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32 || key.toString('base64') !== base64Key) {
    throw new Error('YOUTUBE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return key;
}

export function encryptRefreshToken(token: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

export function decryptRefreshToken(value: string, base64Key: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted YouTube token.');
  const [iv, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted YouTube token.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(base64Key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
