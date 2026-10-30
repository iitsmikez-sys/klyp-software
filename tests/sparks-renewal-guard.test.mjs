import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const userId = '11111111-1111-4111-8111-111111111111';

test('expired Pro profile cannot refill Sparks without a paid invoice', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '${userId}'::uuid $$;
      create table public.profiles (
        id uuid primary key, tier text not null default 'free',
        sparks integer not null default 150,
        sparks_reset_at timestamptz not null default now() + interval '30 days',
        stripe_customer_id text, stripe_subscription_id text
      );
      create function public.tier_allowance(t text) returns integer language sql immutable
        as $$ select case t when 'pro' then 500 else 150 end $$;
      insert into public.profiles (id, tier, sparks, sparks_reset_at)
        values ('${userId}', 'pro', 0, now() - interval '1 day');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/012_sparks_ledger.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/025_paid_sparks_invoice_only.sql', import.meta.url), 'utf8'));
    const profile = await db.query('select tier, sparks from public.get_profile()');
    assert.deepEqual(profile.rows[0], { tier: 'pro', sparks: 0 });
    const ledger = await db.query("select count(*)::int as n from public.spark_transactions where reason = 'monthly_reset'");
    assert.equal(ledger.rows[0].n, 0);

    const adminProfile = await db.query(`select tier, sparks from public.admin_get_profile('${userId}')`);
    assert.deepEqual(adminProfile.rows[0], { tier: 'pro', sparks: 0 });

    await db.query('select public.grant_tier_sparks($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [userId, null, 'pro', 500, new Date(Date.now() + 30 * 86400_000).toISOString(),
        'in_paid', 'invoice_grant', 'cus_test', 'sub_test', true]);
    const afterInvoice = await db.query(`select tier, sparks from public.get_profile()`);
    assert.deepEqual(afterInvoice.rows[0], { tier: 'pro', sparks: 500 });

    await db.query(`update public.profiles set tier = 'free', sparks = 0,
      sparks_reset_at = now() - interval '1 day' where id = '${userId}'`);
    const freeProfile = await db.query('select tier, sparks from public.get_profile()');
    assert.deepEqual(freeProfile.rows[0], { tier: 'free', sparks: 150 });
  } finally { await db.close(); }
});
