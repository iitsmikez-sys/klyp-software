# Experimental VOD discovery v2

This branch changes no customer behavior by default. `KLYP_DISCOVERY_V2=1` is the only route to the new pipeline; the setting is absent in production. Migration `024_vod_analysis_cache.sql` is **not applied**. Keep automatic clipping paused until the existing Anthropic credit issue is resolved separately.

## What the new path does

- Retains Claude Opus 4.8 as the final clip judge. Chat rates, speech-band audio changes, and selected scene changes propose timestamps only. A signal alone cannot become a clip. Opus must find context, entertainment value, and payoff in the transcript, and the existing visual finalist check still runs.
- Spreads Twitch chat sampling through the entire VOD. For VODs at least two hours long, proposes strong chat moments, audio changes, and at least one low-chat candidate per hour. Shorter VODs and uploads still get full audio transcription. If the audio scan fails, the new path transcribes the full VOD rather than quietly shrinking coverage.
- Downloads/transcodes source audio once into a bounded disk cache, records its expected duration, and rejects a truncated download. Transcript cache records exact closed-open VOD intervals, actual audio duration, model, version, and words. Only validated intervals can be reused; missing intervals are transcribed. Result cache reuses Opus-judged candidates for repeat requests. If its remaining candidates are exhausted, a new Opus call asks for different moments from the existing transcript.
- Blocks overlapping work for the same user and source on the current single Node instance. This is not a cross-replica lock; horizontal scaling needs a database lease.
- Leaves Sparks, plans, clip export, and the timeline editor untouched. The old path is used whenever the flag is absent.

## Cost and quality gates

- Each stage logs elapsed time and measured units. AssemblyAI audio seconds and Claude input/output/cache tokens are logged by run ID with **list-price estimates**. Archive logs measured bytes and time. These are not provider invoices or exact infrastructure charges.
- A preflight estimate pauses a run above `KLYP_MAX_VOD_ESTIMATED_USD` (default $5) without dropping candidate windows. This is an estimate, **not a guaranteed maximum bill**. The value should be reviewed against real provider usage before enabling v2. Do not treat a lower cost as success if clip quality declines.
- `scripts/compare-discovery.mjs` compares old and new outputs against human-labeled known moments, hourly coverage, human relevance/context/payoff/editing ratings, measured cost, and processing time. It exits nonzero if recall or any quality dimension falls. The included unit test is synthetic; it is not evidence that v2 matches the old system on real VODs.

## Required comparison before enabling

Get the user's approval for a stated maximum paid test budget **before** running any real VOD through AssemblyAI or Claude. Use at least three VODs (about 1, 4, and 10 hours) with permission to process them. Record URLs, durations, and known entertaining timestamps, including quiet-chat jokes, gameplay surprises, high-chat reactions, and conversational payoffs. Run each through the existing and candidate systems in an isolated environment, label the resulting clips without knowing which system made them, and save costs and time from provider logs. Compare missed moments, ranking, context, payoff, editing quality, and cost. Reject or revise v2 if any quality metric regresses, even if it is cheaper.

The SQL migration needs a non-production staging run with realistic RLS and cache reuse tests. Test a failed download, a partial transcript, exhausted cached results, a longer VOD, repeated requests, and multiple users. Confirm the feature flag remains off and only then consider an explicitly approved release. No deployment or migration is part of this branch.
