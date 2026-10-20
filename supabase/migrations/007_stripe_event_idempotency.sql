-- Webhook idempotency — run in the Supabase SQL editor (after 001-006).
--
-- Stripe delivers events at least once: any non-2xx, timeout or network blip
-- makes it retry, and the same event can legitimately arrive more than once.
-- The webhook grants a full Sparks allotment per billing event, so a redelivery
-- used to reset a partly-spent balance back to the full allowance — verified in
-- test mode: a replayed checkout.session.completed took a profile from 100
-- Sparks back to 500.
--
-- This table records which Stripe event ids have been applied. The webhook
-- inserts the id first and treats a unique-violation as "already handled".
--
-- Server-only: the webhook uses the service-role client, which bypasses RLS.
-- RLS stays enabled so anon/authenticated clients get nothing.

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_events enable row level security;

-- No policies: end users never read or write this table.

-- Housekeeping: these rows are only needed for the retry window (Stripe retries
-- for up to ~3 days). Safe to prune anything older than a month.
create index if not exists stripe_events_processed_at_idx
  on public.stripe_events (processed_at);
