# Klyp — AI clipping for livestreamers

Klyp analyzes published Twitch and YouTube videos, suggests moments, and lets users preview, save, edit, and export clips. A connected Twitch channel can queue new published VODs for automatic analysis. Saved clips are queued for storage in a private media bucket so they remain usable if the source VOD disappears.

## Local development

1. Run `npm ci`.
2. Install FFmpeg and yt-dlp, or set `FFMPEG_PATH` and `YTDLP_PATH` to their absolute executable paths.
3. Copy `.env.example` to `.env.local` and configure Supabase, AssemblyAI, Anthropic, and any integrations you plan to exercise.
4. Apply Supabase migrations in numeric order. Migrations `016_auto_vod_jobs.sql` and `017_clip_archive_queue.sql` must be applied before deploying their processing worker code.
5. Set `DEPLOYMENT_TARGET=processing` on the processing service and run `npm run dev` locally or deploy that service as documented in [SETUP.md](SETUP.md).

## Architecture

- `app/api/analyze/route.ts` and `lib/analyze-pipeline.ts`: transcription and clip suggestions.
- `lib/vod-poll.ts`: Twitch VOD discovery and durable processing jobs.
- `lib/clip-archive-worker.ts`: saved-clip archival.
- `app/api/clip/route.ts`, `app/api/preview/route.ts`, and `app/api/thumbnail/route.ts`: export and previews.
- `components/ClipTimelineEditor.tsx` and `app/(editor)/dashboard/clips/[id]/edit/page.tsx`: full saved-clip timeline editing.
- `components/SavedClipEditor.tsx` and `components/LegacySavedClipEditor.tsx`: quick edits and existing device drafts.
- `supabase/migrations/`: database schema and service-role job functions.

Run `npm run typecheck` and `npm test` for automated checks. `tests/homepage-demo.mjs` expects a running local server at `127.0.0.1:3000` with demo footage installed, so run it separately after starting the app.
