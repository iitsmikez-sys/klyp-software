# Editor integration verification

## Merge strategy

Integrated published editor stack `cf5861f` into current main `e974bea` on
`codex/editor-main-integration` using a normal two-parent merge. The published
stack has the same tree as the locally tested `a74d246`.

The ten conflicts were resolved around the stack's V3 timeline editor, source
anchored cutaways, owned private media, cleanup queue and shared preview/export
composition. The V3 workspace is the default for new edits. Existing device drafts under
`klyp-editor-{clip.id}` open the preserved main editor, timeline and renderer.
An explicit switch opens the separate V3 workspace without deleting the device
draft. Sequential legacy inserts extend duration and therefore cannot safely be
converted into source-anchored V3 cutaways. Legacy caption helper APIs remain
available for single-range exports and tests.

Main behavior retained:

- Repeat-VOD billing protections, analysis history, and allowance ledger files
  are unchanged from main.
- Free Original exports retain native framing and the Free watermark. The full
  timeline offers **Export original** with an explicit notice; it exports the
  original clip even after a Pro downgrade without changing the saved V3 draft.
  New editing, save and import remain Pro features. Both format pickers use the
  shared access policy.
- Archived masters use the floor of the original saved start. Preview playback,
  thumbnails and audio peaks read `X-Klyp-Source` to use the same source origin.
- Legacy caption color/position presets remain supported alongside V3 cue layout.
- Processing CORS allows `x-clip-id` and exposes both `X-Klyp-Source` and
  `X-Klyp-Layout-Warning`.
- Main's Found Moments page wording is retained with the new editor entry point.

## Migration order

The existing main migrations `014_analysis_clip_history.sql` and
`015_free_allowance_ledger.sql` are byte-for-byte unchanged. Incoming files are
`013_clip_edit_draft.sql`, `016_vertical_layout.sql`, and `017_editor_media.sql`.
The rollback-only cleanup verification script is now
`supabase/tests/017_editor_media_cleanup.sql`. All media/layout filename and
number references were updated.

Repository numbering does not prove live application. Production editor columns
and the private media bucket were reported absent during the parent task's
read-only inspection. No SQL has been applied by this integration. Follow
[editor media setup](editor-media-setup.md) and verify the actual schema before
deployment; do not rerun unrelated migrations merely because a file exists.

## Verification

| Check | Result |
| --- | --- |
| Main baseline, exact `e974bea` files extracted into ignored scratch | 49/49 pass |
| Full Node suite, including main billing/SQL and stack FFmpeg tests | 229/229 pass |
| Integration seam tests plus route/legacy caption coverage | 22/22 pass |
| TypeScript, `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Pass |
| `node tests/editor-media.browser.cjs` | Pass, including fractional archive seek, loading/clock, pointer/keyboard trims |
| `node tests/editor-composition.browser.cjs` | Pass, canvas versus independent FFmpeg crop and actual export filters |
| `node tests/editor-import.browser.cjs` | Pass, mounted photo/video import, save/reload, ownership-boundary fixtures, media playback, cutaway controls, responsive checks, Free/downgrade original export, and legacy restore/export/switch persistence |
| `node scripts/editor-interactions.test.cjs` | Blocked: Next server started; browser localhost navigation returned `ERR_NETWORK_ACCESS_DENIED` |
| Production `next build` | Blocked: Google Fonts fetch `ENOTFOUND`; parent retry hit sandbox `EPERM` creating generated route type folders |
| `git diff --check` | Pass |

Full Node command:

```powershell
node --experimental-strip-types --test lib/*.test.ts tests/*.test.mjs tests/clip-trim.mjs tests/edit-segments.mjs tests/editor-captions.mjs tests/editor-integration.mjs tests/editor-media.mjs tests/editor-media-render.mjs
```

New seam tests were run red before fixes: fractional archived rendering used
100.75 instead of 100, Free Original exports were vertically composed, legacy
caption options were dropped, the layout warning was not exposed by CORS, and
the preview origin helper was absent. Review also caught device-draft fallback
and Free/downgrade export regressions; compatibility tests were run red before
fixes. A mounted pointer test caught the fixed-position workspace obscuring the
compatibility switch, and passed after moving the switch into the workspace.
They pass after integration. Existing
Node module-type warnings remain. Initial baseline attempts lacked installed
dependencies; the exact-main baseline was rerun successfully after local install.

Logs are retained under ignored `logs/`. Generated browser fixtures and evidence
are ignored and excluded from TypeScript so synthetic apps do not enter builds.
No package or lockfile change was needed for the integration.

## Remaining release gates

The legacy fallback retains the released editor's existing storage and sequential
insert semantics. New V3 assets continue to use the private media bucket and
cleanup queue. The additional legacy code is intentional compatibility code and
should only be retired after existing device drafts have a supported migration.

The successful tests use local media and synthetic service/auth boundaries. They
do not establish installed database triggers, live RLS, signed-upload replay,
Storage cleanup, or behavior under production credentials. The new cleanup SQL
script has not been applied or run against a Supabase project. Production build
and real App Router navigation/save verification remain required in an
environment that permits their filesystem and network operations.

No remote push, GitHub merge, migration application, deployment, live service
change, Spark expenditure, or worktree deletion was performed. The parent task
owns independent review and any subsequent publication/deployment decision.
