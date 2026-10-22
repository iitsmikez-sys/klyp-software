-- 011: raise the free allowance from 60 to 150 Sparks.
--
-- A typical run (45-minute VOD, default 5 clips) costs 40 Sparks, so 60 bought
-- exactly one analysis. A single run is one roll of the dice: a quiet stream
-- produces weak clips and the user leaves having learned nothing about what
-- Klyp is good at. 150 is three runs.
--
-- Keep in sync with SPARKS_ALLOWANCE in lib/tier.ts.
create or replace function public.tier_allowance(t text)
returns integer language sql immutable
as $$ select case t when 'pro' then 500 else 150 end $$;

-- Existing free users keep their current balance until their own 30-day reset
-- lands, which would leave them on the old allowance for up to a month. Top up
-- anyone currently below the new floor; never reduce a balance.
update public.profiles
   set sparks = 150
 where tier <> 'pro' and sparks < 150;
