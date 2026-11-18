# Smooth Sparks pricing (migration 053)

## The price
A video costs **10 Sparks plus 1 Spark for every 5 minutes**, rounded **up** to the next multiple of 5. Clips are included.

| Video | Sparks (before -> now) |
|---|---|
| 15 min | 20 -> 15 |
| 30 min | 35 -> 20 |
| 1 hour | 50 -> 25 |
| 90 min | 50 -> 30 |
| 2 hours | 65 -> 35 |
| 4 hours | 65 -> 60 |
| 6 hours | 80 -> 85 |
| 8 hours | 120 -> 110 |

Also changed: **Free is 40 Sparks** (was 60) for new accounts and future 30-day refills, and the **$3 pass gives 150 Sparks** (was 250).
People who already have Sparks keep them until their next refill. Nothing is taken away.

## Order matters: run the SQL FIRST
The price is calculated in two places that must agree: the app (`estimateSparks` in `lib/sparks.ts`, what the screen shows) and the
database (`record_analysis_clips`, what is actually charged). If only one is updated, a video can be shown at one price and charged another.
1. Supabase, SQL editor, paste `supabase/migrations/053_smooth_sparks.sql`, Run.
2. Then merge the pull request and let Vercel and Railway deploy.
(Between steps 1 and 2 the database charges the new price while the old screen still shows the old one, so do them close together.)

## Rolling back
Re-run migration 050's `record_analysis_clips` and 029's `tier_allowance`, and revert the pull request.

## Tests
`tests/long-video-budget.test.mjs` runs the real SQL in an in-memory Postgres and checks it equals the app's price on more than 28,000 lengths.
