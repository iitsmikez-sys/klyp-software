# Saved clip editor: trim and text

## Purpose and scope

Klyp users should be able to refine an analyzed clip, return later, and export the same choices. The first release adds trim, title, hook, and caption-word correction to the existing saved-clip editor. Direct social posting, scheduling, a multitrack timeline, and generating missing transcripts are separate work.

Existing clips remain intact. An edit is a single saved draft attached to its source clip, and reset can restore the original analysis. The existing Pro gate on the Edit Clip action remains; exports retain their current tier checks and watermark behavior. No Sparks are charged for saving a draft. Existing export costs still apply.

## User flow

1. Open a saved clip's Edit Clip action. The player loads the original clip, then applies a saved draft if one exists.
2. Move trim start and end within the original clip's boundaries. The editor shows the selected duration and plays only the selected range. It rejects an empty range and any range over the export limit of three minutes.
3. Change the title and on-screen hook. If the clip has timed words, correct individual caption words while retaining their timestamps; choose the existing caption style, hook style, and export format.
4. Save the draft. A success indicator appears only after the server confirms the write. Closing with unsaved changes warns the user. Reopening reloads the draft. Reset restores the original values after confirmation.
5. Export uses the current editor values, including changes not yet saved, so the exported file matches what the user sees. The UI makes unsaved status explicit. Save and export failures keep the edits on screen and provide a retry path.

Older clips without `words` can use trim, title, and hook. Their caption correction control explains that timed words are unavailable; the editor does not fabricate timings. If preview footage is unavailable, the UI reports that clearly and does not claim the export will succeed.

## Data and API

Add nullable `public.clips.edit_draft jsonb` in a separate, idempotent migration for manual application in the Supabase SQL editor. The original `start_seconds`, `end_seconds`, `title`, `hooks`, and `words` remain the immutable analysis result. The draft holds a version number and validated fields: absolute VOD trim times, title, hook text, hook and caption styles, export format, and optionally corrected timed words. Null means no draft. The client type and load path understand null and unknown future versions.

A Next.js save endpoint authenticates the session, verifies the clip belongs to that user, checks the confirmed Pro subscription for editing, validates and bounds all fields, then writes only `edit_draft`. It must not accept changes to `user_id`, viral score, archive paths, or source URL. Reset clears only `edit_draft`. The database keeps RLS enabled; the server uses the established authenticated session and narrowly scoped write path. No broad client update policy is added.

Validation includes trim within the original range, positive duration at most 180 seconds, bounded nonempty title, hook at most 80 characters, known style/format enums, and corrected words with finite ordered timestamps inside the original clip. The correction workflow changes text only; word start/end times come from the stored original. Empty or malformed draft requests return useful 4xx errors.

## Preview and export

The preview player uses the original archived proxy when available and constrains playback to the draft trim. The original cut remains available for resetting. Hook and caption text changes appear as overlays in the editor; existing FFmpeg burn logic remains the final export renderer. Export passes the selected absolute trim, title, hook, styles, format, and corrected words to `/api/clip`, with `clip_id` so archived masters continue working when the source VOD has expired.

An archived master begins at the original clip start. The export route must seek using that original start as the master offset, then apply the edited trim; using the edited start as the offset would incorrectly export from the master beginning. This adjustment must preserve the existing source-VOD export path and ownership check.

## Components and boundaries

- `SavedClipEditor` owns temporary form state and feedback. A small trim control and caption-word editor keep UI concerns separate from request validation.
- Shared draft types and validation define the persisted shape and protect the save endpoint.
- The save endpoint owns authentication, authorization, and persistence.
- The processing export route remains responsible for rendering and archived-master timing.
- The migration only adds the draft column. It is supplied as SQL and never auto-applied by a CLI.

## Verification and release

Test draft validation and ownership, trim math on source and archived masters, reload/reset, caption correction preserving timestamps, and export request values. Run TypeScript, lint, and the relevant tests. Manually check a clip with timed words and an older clip without them. Open a PR from a new branch; do not push to main. Apply the SQL by hand before exposing Save in production, and verify a saved draft survives reload and exports the selected range. A preview deployment connected to live Supabase must not write a test draft into someone else's clips.
