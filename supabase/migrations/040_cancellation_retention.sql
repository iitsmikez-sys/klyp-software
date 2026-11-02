-- Cancellation retention: what people said when they thought about cancelling, and which retention
-- offers (a one-payment 40% discount, a 1 or 2 month pause) were started for them. All writes come
-- from the server with the service role; users have no direct access.
begin;

create table if not exists public.cancellation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_subscription_id text,
  reason text not null check (reason in ('not_good_clips', 'break', 'too_expensive', 'not_using', 'other')),
  sub_reason text check (sub_reason in ('not_entertaining', 'missing_moments', 'cut_off', 'other')),
  detail text check (char_length(detail) <= 1000),
  -- what the person finally did with this survey
  decision text not null default 'none' check (decision in ('none', 'accepted_offer', 'declined_offer', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cancellation_events_user_idx on public.cancellation_events (user_id, created_at desc);

create table if not exists public.retention_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid references public.cancellation_events(id) on delete set null,
  stripe_subscription_id text not null,
  offer text not null check (offer in ('discount_40', 'pause_1', 'pause_2')),
  -- pending: claimed, Stripe not yet confirmed. confirmed: Stripe shows it applied. failed: it did not apply.
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed')),
  stripe_ref text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists retention_offers_user_idx on public.retention_offers (user_id, offer, created_at desc);
-- At most one unfinished claim per person and offer type, so a double click or two tabs cannot both go through.
create unique index if not exists retention_offers_one_pending_idx
  on public.retention_offers (user_id, offer) where status = 'pending';

alter table public.cancellation_events enable row level security;
alter table public.retention_offers enable row level security;
revoke all on public.cancellation_events, public.retention_offers from anon, authenticated;
grant all on public.cancellation_events, public.retention_offers to service_role;

-- Claim an offer for a subscription. The discount is limited to once every 180 days per person, and
-- this is where that is enforced, atomically, whatever the caller sends. Returns the claim id.
create or replace function public.claim_retention_offer(
  p_user_id uuid, p_event_id uuid, p_subscription_id text, p_offer text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_last timestamptz;
begin
  if p_user_id is null or p_subscription_id is null or p_offer not in ('discount_40', 'pause_1', 'pause_2') then
    raise exception 'invalid retention offer';
  end if;
  -- Serialise claims by the same person.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 40));
  if p_offer = 'discount_40' then
    select max(coalesce(confirmed_at, created_at)) into v_last from public.retention_offers
      where user_id = p_user_id and offer = 'discount_40' and status in ('pending', 'confirmed');
    if v_last is not null and v_last > now() - interval '180 days' then
      raise exception 'discount_not_eligible:%', to_char(v_last + interval '180 days', 'YYYY-MM-DD');
    end if;
  end if;
  insert into public.retention_offers (user_id, event_id, stripe_subscription_id, offer)
    values (p_user_id, p_event_id, p_subscription_id, p_offer) returning id into v_id;
  return v_id;
end $$;

-- Record how an offer ended. A failed claim does not count towards the 180 days.
create or replace function public.finish_retention_offer(
  p_offer_id uuid, p_status text, p_ref text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('confirmed', 'failed') then raise exception 'invalid status'; end if;
  update public.retention_offers
    set status = p_status, stripe_ref = coalesce(p_ref, stripe_ref),
        confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end
    where id = p_offer_id and status = 'pending';
end $$;

revoke all on function public.claim_retention_offer(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finish_retention_offer(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_retention_offer(uuid, uuid, text, text) to service_role;
grant execute on function public.finish_retention_offer(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
