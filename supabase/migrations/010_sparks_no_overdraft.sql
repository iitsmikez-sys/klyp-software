-- 010: refuse Sparks overdrafts instead of silently draining the balance.
--
-- Both consume functions deducted with `greatest(0, sparks - amount)`, so a
-- charge larger than the balance zeroed the account and returned success. A
-- caller passing a wrong amount could wipe a paying customer's Sparks with no
-- error raised anywhere and nothing recorded. That is how this was found: a
-- single probe with an absurd amount took a real account from 342 to 0, and
-- every layer above reported that it had worked.
--
-- Refusing is the safer direction. An overdraft now means the estimate was
-- wrong or a caller is buggy, and the customer is under-charged rather than
-- emptied — a bounded, recoverable error instead of an unbounded one.

create or replace function public.consume_sparks(amount integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare remaining integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if amount is null or amount < 0 then
    raise exception 'invalid amount';
  end if;
  -- Lock the row so a concurrent charge can't read a stale balance and let
  -- both deductions through.
  select sparks into remaining from public.profiles where id = auth.uid() for update;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  if remaining < amount then
    raise exception 'insufficient sparks: need %, have %', amount, remaining;
  end if;
  update public.profiles
     set sparks = sparks - amount
   where id = auth.uid()
   returning sparks into remaining;
  return remaining;
end $$;

create or replace function public.admin_consume_sparks(target_user uuid, amount integer)
returns integer
language plpgsql security definer set search_path = public
as $$
declare remaining integer;
begin
  if amount is null or amount < 0 then
    raise exception 'invalid amount';
  end if;
  select sparks into remaining from public.profiles where id = target_user for update;
  if remaining is null then
    raise exception 'profile not found';
  end if;
  if remaining < amount then
    raise exception 'insufficient sparks: need %, have %', amount, remaining;
  end if;
  update public.profiles
     set sparks = sparks - amount
   where id = target_user
   returning sparks into remaining;
  return remaining;
end $$;

revoke all on function public.admin_consume_sparks(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_consume_sparks(uuid, integer) to service_role;
