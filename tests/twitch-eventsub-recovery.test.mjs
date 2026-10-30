import assert from 'node:assert/strict';
import test from 'node:test';

process.env.TWITCH_CLIENT_ID = 'test-client';
process.env.TWITCH_CLIENT_SECRET = 'test-secret';
process.env.TWITCH_EVENTSUB_SECRET = 'test-eventsub-secret';

const { ensureStreamOfflineSubscription } = await import('../lib/twitch.ts');

test('reuses an active Twitch EventSub subscription instead of creating a duplicate', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([String(url), options?.method ?? 'GET']);
    if (String(url).includes('/oauth2/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
    if (String(url).includes('/eventsub/subscriptions') && !options?.method) return Response.json({ data: [{ id: 'existing-sub', status: 'enabled', type: 'stream.offline', condition: { broadcaster_user_id: '123' }, transport: { callback: 'https://worker.example/api/twitch/eventsub' } }], pagination: {} });
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const id = await ensureStreamOfflineSubscription('123', 'https://worker.example/api/twitch/eventsub');
    assert.equal(id, 'existing-sub');
    assert.equal(calls.some(([url, method]) => url.includes('/eventsub/subscriptions') && method === 'POST'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('records EventSub ID with an owner check and reports failed persistence', async () => {
  const { saveEventSubSubscription } = await import('../lib/twitch-subscription.ts');
  const writes = [];
  const client = { from(table) {
    assert.equal(table, 'streams');
    return { update(values) {
      writes.push(values);
      return { eq(column, value) {
        writes.push([column, value]);
        return { eq(ownerColumn, ownerId) {
          writes.push([ownerColumn, ownerId]);
          return { select() { return { maybeSingle: async () => ({ data: null, error: { message: 'write rejected' } }) }; } };
        } };
      } };
    } };
  } };
  await assert.rejects(saveEventSubSubscription(client, 'stream-1', 'user-1', 'sub-1'), /write rejected/);
  assert.deepEqual(writes, [{ eventsub_subscription_id: 'sub-1' }, ['id', 'stream-1'], ['user_id', 'user-1']]);
});
