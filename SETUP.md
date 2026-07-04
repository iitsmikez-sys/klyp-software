# Klyp — Setup & Deploy

## What's built

- **Analysis pipeline** — paste a Twitch/Kick/YouTube VOD URL → yt-dlp audio download → AssemblyAI transcript → Claude finds the 5 best moments (type, viral score, title, caption, timestamps)
- **Twitch chat spike detection** — chat replay is sampled in parallel with the download; windows where chat exploded are fed to Claude as ranking signals (automatic for `twitch.tv/videos/…` URLs, silent no-op elsewhere)
- **Export** — FFmpeg cuts each clip, crops 9:16 1080×1920, burns captions (BOLD / CLEAN / KLYP), optional `@handle` overlay (top-right), animated `klyp.world` watermark on free tier
- **Download all as ZIP** — renders every clip and bundles them client-side
- **Sparks** — server-enforced credits in Supabase. Free = 60/mo, Pro = 500/mo. Cost estimated before analysis (10–50 ⚡ by VOD length), deducted server-side after. Monthly reset is lazy (applied on next profile read)
- **Stripe** — Pro subscription ($29/mo), checkout + billing portal + webhook that flips the profile tier

## One-time setup (do these in order)

### 1. Supabase — run the Sparks migration

Open **Supabase Dashboard → SQL Editor**, paste the contents of
`supabase/migrations/001_sparks_profiles.sql`, and run it.

This creates the `profiles` table (tier + Sparks), auto-provisions profiles on
signup (and backfills existing users on first request), and adds the
`get_profile()` / `consume_sparks()` RPCs the app calls.

### 2. Supabase — service role key

**Dashboard → Settings → API → `service_role`** — copy into `.env.local`:

```
SUPABASE_SERVICE_ROLE_KEY=eyJ…
```

Only the Stripe webhook uses it (webhooks have no user session). Never expose it client-side.

### 3. Stripe

1. Create an account at stripe.com (test mode is fine to start)
2. **Developers → API keys** → copy the secret key:
   ```
   STRIPE_SECRET_KEY=sk_test_…
   ```
3. For local webhook testing, install the Stripe CLI and run:
   ```
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```
   Copy the printed `whsec_…` into:
   ```
   STRIPE_WEBHOOK_SECRET=whsec_…
   ```
4. `STRIPE_PRICE_PRO` is optional — leave empty and Klyp creates the $29/mo
   price inline at checkout. Set it to a `price_…` id if you pre-create the
   product in the Stripe dashboard (cleaner for prod).

Without the webhook running, checkout succeeds but the profile never flips to
Pro — the webhook is what grants the tier.

### 4. Test the flow end-to-end

1. `npm run dev`
2. Sign in → dashboard shows **60 ⚡** (real balance from Supabase)
3. Paste a Twitch VOD URL → cost preview appears → Find clips → balance drops after analysis
4. Set a streamer handle → Export → `@handle` top-right, watermark drifting
5. **Download all (.zip)** → renders all 5 and saves one archive
6. **Upgrade to Pro** → Stripe test card `4242 4242 4242 4242` → webhook fires →
   balance becomes 500 ⚡, watermark gone, button becomes **Manage billing**

## Deploying to production

FFmpeg and yt-dlp can't run on Vercel serverless, so the app splits:

| Piece | Where | Notes |
|---|---|---|
| Next.js app (UI, auth, Stripe) | Vercel | works as-is |
| Video processing (`/api/analyze`, `/api/clip`, `/api/preview`, `/api/duration`) | Railway or Render (Docker) | needs ffmpeg + yt-dlp installed in the image |

Recommended path (roughly a day of work when you're ready):

1. **Railway worker** — deploy this same Next.js repo as a Docker service with
   `ffmpeg` and `yt-dlp` in the image. It serves the processing routes.
2. **Vercel rewrites** — in `next.config.mjs`, rewrite `/api/analyze`,
   `/api/clip`, `/api/preview`, `/api/duration` to the Railway URL so the
   frontend needs no code changes. Auth cookies forward automatically on the
   same domain if you put the worker behind a subdomain (e.g. `worker.klyp.world`).
3. **Stripe prod webhook** — Dashboard → Webhooks → add
   `https://<your-app>/api/stripe/webhook` with events
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`; put its `whsec_…` in the Vercel env.
4. Set all `.env.local` vars in both Vercel and Railway.

## Env reference

See `.env.example` for the full annotated list.
