import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const userId = '11111111-1111-4111-8111-111111111111';

test('the Sparks ledger rolls back a duplicate invoice reference after a spent balance', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.profiles (
        id uuid primary key, tier text not null default 'free',
        sparks integer not null default 150,
        sparks_reset_at timestamptz not null default now() + interval '30 days',
        stripe_customer_id text, stripe_subscription_id text
      );
      create function public.tier_allowance(t text) returns integer language sql immutable
        as $$ select case t when 'pro' then 500 else 150 end $$;
      insert into public.profiles (id) values ('${userId}');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/012_sparks_ledger.sql', import.meta.url), 'utf8'));
    const grant = () => db.query(
      'select public.grant_tier_sparks($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [userId, null, 'pro', 500, new Date(Date.now() + 30 * 86400_000).toISOString(),
        'in_same', 'invoice_grant', 'cus_test', 'sub_test', true]);
    await grant();
    await db.query('update public.profiles set sparks = 100 where id = $1', [userId]);
    await assert.rejects(grant(), error => error.code === '23505');
    const profile = await db.query('select sparks from public.profiles where id = $1', [userId]);
    assert.equal(profile.rows[0].sparks, 100);
    const ledger = await db.query("select count(*)::int as n from public.spark_transactions where reason = 'invoice_grant'");
    assert.equal(ledger.rows[0].n, 1);
  } finally { await db.close(); }
});
