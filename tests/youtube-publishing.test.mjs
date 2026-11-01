import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isConfirmedPro, validateYouTubePost, encryptRefreshToken, decryptRefreshToken,
  canRetryUncertainPost,
} from '../lib/youtube-publishing.ts';

test('publishing accepts paid or complimentary Pro access', () => {
  assert.equal(isConfirmedPro({ tier: 'pro', stripe_subscription_id: 'sub_123' }), true);
  assert.equal(isConfirmedPro({ tier: 'pro', stripe_subscription_id: null, complimentary_pro: true }), true);
  assert.equal(isConfirmedPro({ tier: 'pro', stripe_subscription_id: null }), false);
  assert.equal(isConfirmedPro({ tier: 'free', stripe_subscription_id: 'sub_123' }), false);
  assert.equal(isConfirmedPro({ tier: 'free', stripe_subscription_id: null, complimentary_pro: true }), false);
});

test('YouTube title, description, and future schedule are validated', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.throws(() => validateYouTubePost({ title: '  A great clip  ', description: ' hi ', publishAt: null }, now), /schedule/i);
  assert.equal(validateYouTubePost({ title: 'Short', description: '', publishAt: '2026-10-30T13:00:00Z' }, now).publishAt,
    '2026-10-30T13:00:00.000Z');
  assert.throws(() => validateYouTubePost({ title: '', description: '' }, now), /title/i);
  assert.throws(() => validateYouTubePost({ title: 'x'.repeat(101), description: '' }, now), /title/i);
  assert.throws(() => validateYouTubePost({ title: 'Clip', description: 'x'.repeat(5001) }, now), /description/i);
  assert.throws(() => validateYouTubePost({ title: 'Clip', description: '', publishAt: '2026-10-30T12:01:00Z' }, now), /future/i);
  assert.throws(() => validateYouTubePost({ title: 'Clip', description: '', publishAt: '2026-10-30T12:20:00Z' }, now), /future/i);
  assert.throws(() => validateYouTubePost({ title: 'Clip', description: '', publishAt: 'bad' }, now), /date/i);
});

test('scheduled posts require public visibility when they go live', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(validateYouTubePost({ title: 'Clip', description: '', privacyStatus: 'public',
    publishAt: '2026-10-30T13:00:00Z' }, now).privacyStatus, 'public');
  assert.throws(() => validateYouTubePost({ title: 'Clip', description: '', privacyStatus: 'hidden' }, now), /privacy/i);
  assert.throws(() => validateYouTubePost({ title: 'Clip', description: '', privacyStatus: 'private',
    publishAt: '2026-10-30T13:00:00Z' }, now), /public/i);
});

test('refresh tokens encrypt at rest and reject tampering', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptRefreshToken('secret-refresh-token', key);
  assert.notEqual(encrypted, 'secret-refresh-token');
  assert.equal(decryptRefreshToken(encrypted, key), 'secret-refresh-token');
  assert.throws(() => decryptRefreshToken(encrypted.slice(0, -2) + 'AA', key));
  assert.throws(() => encryptRefreshToken('token', 'bad-key'), /key/i);
});

test('an uncertain upload requires an hour, no confirmed video ID, and explicit review', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(canRetryUncertainPost({ status: 'processing', youtube_video_id: null,
    created_at: '2026-10-30T10:00:00Z' }, now), true);
  assert.equal(canRetryUncertainPost({ status: 'needs_review', youtube_video_id: null,
    created_at: '2026-10-30T11:30:00Z' }, now), false);
  assert.equal(canRetryUncertainPost({ status: 'needs_review', youtube_video_id: 'video123',
    created_at: '2026-10-30T10:00:00Z' }, now), false);
  assert.equal(canRetryUncertainPost({ status: 'scheduled', youtube_video_id: 'video123',
    created_at: '2026-10-30T10:00:00Z' }, now), false);
});
