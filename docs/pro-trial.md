# The 4-day Pro pass: how to turn it on

The pass is built and OFF. Nothing changes for visitors until you do the steps below.

## What it is
- **$3 today** for 4 days of Pro. A card is required. The $3 is not refunded.
- After 4 days the card is charged **$28** (the normal Pro month, with the full 500 Sparks), unless they cancel before day 4.
- 250 Sparks during the 4 days. The full 500 arrive with the first $28 payment.
- Only people who never subscribed before. One pass per account, per real email (Gmail dots and +tags are ignored), and per card.
- A second pass on the same email or card is cancelled right away, and its $3 is refunded automatically. (If the refund ever fails, the logs say `[stripe] REFUND NEEDED BY HAND`: refund that $3 in Stripe.)
- **Ad visitors get the $17 first month instead** (the offer that already exists), so nobody sees both offers. The pass is for everyone else who is new.

## Steps, in order
1. **Run the database change.** Supabase, SQL editor, paste `supabase/migrations/051_trial_uses.sql`, Run. Until you do, nobody is offered the pass.
2. **Merge the pull request** and wait for Vercel and Railway to deploy.
3. **Turn on Stripe's "trial ending" reminder email.** Stripe Dashboard, Settings, Billing, Subscriptions and emails. It goes out 3 days before the end, which is day 1 of the 4. Without it, people get charged $28 with no heads-up.
4. **Test it once with a NEW account and a Stripe TEST card, in Stripe test mode.** Check three things: (a) checkout charges exactly $3 today and shows $28 after 4 days, (b) the account gets Pro and 250 Sparks, (c) after you advance the test clock past 4 days, it charges $28 and the Sparks become 500. I could not run a payment, so this step matters.
5. **Set `PRO_TRIAL=on`** on BOTH Vercel and Railway, then redeploy both. Remove it, or set it to anything else, to turn the pass off.

## Ads
Your ad link (`klyp.world/?offer=17`) already gives the $17 first month, so the ads should say "Pro for $17 your first month". If you prefer $18, say so: it is a small change to one number and one Stripe coupon.

## What to watch
- Passes started, and how many pay the $28 after day 4. The $3 pass earns more than the $17 offer only if more than half of the people who start it go on to pay the $28.
- Cost: each pass can use up to 250 Sparks, about $1 to $3. The $3 covers it.
- In the logs, `[stripe] trial refused` means a repeat card or email was stopped.
- A person whose repeat pass is refused is left on the Free plan with no message, but they get their $3 back.
