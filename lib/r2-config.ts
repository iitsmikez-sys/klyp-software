/** Server-only R2 configuration. Keeping the flag explicit makes local and
 * existing Supabase deployments behave exactly as before. */
export type R2Config = {
  bucket: string;
  accountId: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const file = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

export function r2Config(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  if (env.R2_ENABLED !== '1') return null;
  const { R2_BUCKET: bucket, R2_ACCOUNT_ID: accountId,
    R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  const jurisdiction = env.R2_JURISDICTION ?? 'default';
  if (!bucket || !accountId || !accessKeyId || !secretAccessKey ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      !/^[0-9a-f]{32}$/i.test(accountId) ||
      !['default', 'eu', 'us', 'fedramp', 'fedramp-high'].includes(jurisdiction)) {
    throw new Error('R2 configuration incomplete or invalid.');
  }
  return { bucket, accountId,
    endpoint: `https://${accountId}${jurisdiction === 'default' ? '' : `.${jurisdiction}`}.r2.cloudflarestorage.com`,
    accessKeyId, secretAccessKey };
}

export function r2ObjectKey(kind: 'vod' | 'clips', userId: string, objectId: string, name: string): string {
  if (!uuid.test(userId) || !uuid.test(objectId) || !file.test(name) || name === '.' || name === '..') {
    throw new Error('Invalid R2 object path.');
  }
  return `${kind}/${userId.toLowerCase()}/${objectId.toLowerCase()}/${name}`;
}
