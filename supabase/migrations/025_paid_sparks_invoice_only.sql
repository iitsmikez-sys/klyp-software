-- Apply after 024_vod_analysis_cache.sql when an existing database is upgraded.
-- Reading an expired Pro profile must never mint Sparks. Only invoice.paid,
-- through grant_tier_sparks(), can start a new paid billing cycle.
begin;

create or replace function public.get_profile()
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  previous_balance integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.profiles (id) values (auth.uid()) on conflict do nothing;
  select * into p from public.profiles where id = auth.uid() for update;
  if p.tier = 'free' and p.sparks_reset_at <= now() then
    previous_balance := p.sparks;
    update public.profiles
       set sparks = tier_allowance(tier),
           sparks_reset_at = now() + interval '30 days'
     where id = p.id returning * into p;
    insert into public.spark_transactions (user_id, delta, reason, balance_after)
    values (p.id, p.sparks - previous_balance, 'monthly_reset', p.sparks);
  end if;
  return p;
end $$;

create or replace function public.admin_get_profile(target_user uuid)
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  previous_balance integer;
begin
  insert into public.profiles (id) values (target_user) on conflict do nothing;
  select * into p from public.profiles where id = target_user for update;
  if p.tier = 'free' and p.sparks_reset_at <= now() then
    previous_balance := p.sparks;
    update public.profiles
       set sparks = tier_allowance(tier),
           sparks_reset_at = now() + interval '30 days'
     where id = p.id returning * into p;
    insert into public.spark_transactions (user_id, delta, reason, balance_after)
    values (p.id, p.sparks - previous_balance, 'monthly_reset', p.sparks);
  end if;
  return p;
end $$;

revoke all on function public.admin_get_profile(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_profile(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
