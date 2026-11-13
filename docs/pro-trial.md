# Pro free trial: how to turn it on

The trial is built and OFF. Nothing changes for visitors until you do the steps below.

## What it is
- 4 days free, a card is required, then $28 a month unless they cancel before day 4.
- 250 Sparks during the trial. The full 500 arrive with the first real payment.
- Only people who never subscribed before. One trial per account, per real email (Gmail dots and +tags are ignored), and per card.
- A second trial on the same email or card is cancelled right away, with no charge.
- It replaces the $17 first-month offer for the same person (they never stack).

## Steps, in order
1. **Run the database change.** Supabase, SQL editor, paste the contents of `supabase/migrations/051_trial_uses.sql`, Run. Until you do, nobody is offered the trial (checkout fails closed and works as before).
2. **Merge the pull request** and wait for Vercel and Railway to deploy.
3. **Turn on Stripe's trial reminder email.** Stripe Dashboard, Settings, Billing, Subscriptions and emails, turn on the email that reminds customers before a trial ends (it goes out 3 days before the end, which is day 1 of a 4-day trial). Without it, people are charged without a heads-up.
4. **Set `PRO_TRIAL`** on BOTH Vercel and Railway, then redeploy both:
   - `PRO_TRIAL=ads` starts with ad-link visitors only (the same `/?offer=17` cookie).
   - `PRO_TRIAL=on` offers it to every new person, including the public pricing page.
   - Remove it, or set it to anything else, to switch the trial off again.
5. **Test it once yourself** with a NEW account and a Stripe test card, if you use Stripe test mode, before sending ad traffic.

## What to watch
- Trials started, and how many become paying after day 4.
- Cost: each trial user can use up to 250 Sparks, about $1 to $3 of AI and transcription.
- In the processing/website logs, `[stripe] trial refused` means a repeat card or email was stopped.
- A person whose repeat trial is refused is left on the Free plan with no message. If that happens often, a message is worth adding.
