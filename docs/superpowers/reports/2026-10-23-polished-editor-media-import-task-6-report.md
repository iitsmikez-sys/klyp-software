# Task 6 — local editor media verification

Status: local verification completed; release remains gated on successful deployment builds, manual migration verification, permitted Next navigation testing, and authenticated real-clip testing. Base commit: `64e5574`. No product behavior change was needed in this pass.

## Changes

- Added `lib/editor-export-mp4.test.ts`, which runs the actual `/api/clip` POST handler and production draft validation, source-cut renderer, cutaway compositor, caption/hook generation, FFmpeg encode, and response creation. Auth, account data, private storage lookup and source download are explicit local fixtures. It never uses credentials or charges Sparks.
- Added `docs/editor-media-setup.md` with manual migration 017 instructions, read-only schema/bucket inspection SQL, required environment variables, live release checks, and the previously deferred verified-object cleanup limitation. Linked it from README and corrected the environment example's obsolete claim that processing needs no service-role key.
- Split the Task 6 plan verification checkbox so passing local checks are marked complete while builds, schema installation, real-account checks and PR/review work remain unchecked.

## Fresh verification results

Evidence files below are in `.superpowers/sdd/2026-10-23-polished-editor-media-import/`.

| Command/check | Result | Evidence |
| --- | --- | --- |
| `node --experimental-strip-types --test --test-reporter=tap lib/*.test.ts tests/*.test.mjs` | **172 passed, 0 failed, 0 skipped**, exit 0 | `task-6-tests-final.tap` |
| `npx tsc --noEmit` | **Pass**, exit 0, no diagnostics | `task-6-tsc-final.txt` |
| `node tests/editor-media.browser.cjs` | **9/9 passed**, exit 0 | `task-6-media-browser.txt` |
| `node tests/editor-import.browser.cjs` | **Pass**, exit 0 | `task-6-import-browser.txt` |
| `node tests/editor-composition.browser.cjs` | **Pass**, exit 0 | `task-6-composition-browser.txt` |
| `node --experimental-strip-types --test lib/editor-export-mp4.test.ts` | **Pass**, exit 0, repeated after TypeScript annotations | `task-6-export-mp4-final.txt` |
| `npm run build` with deployment target unset (frontend) | **Blocked**, exit 1: `fonts.googleapis.com` DNS `ENOTFOUND`, DM Sans fetch fails | `task-6-build.txt` |
| `npm run build` with `DEPLOYMENT_TARGET=processing` | **Blocked**, exit 1: same font fetch error | `task-6-build-processing.txt` |
| Next navigation harness | **Blocked**, exit 1: Chrome `net::ERR_NETWORK_ACCESS_DENIED` at `http://127.0.0.1:3127/` after Next reports ready | `task-6-next-browser.txt` |
| `git diff --check` | **Pass**, exit 0 | Only existing LF/CRLF normalization notices |

The first full Node run also passed 171/171 before adding the MP4 route test. TypeScript initially found five missing HTMLVideoElement casts in the new test; those annotations were corrected and both TypeScript and the focused test passed afterward. No production source correction was required.

`app/layout.tsx` uses `next/font/google` for Syne and DM Sans; Geist is bundled locally. The build failure occurs while fetching DM Sans. Replacing the brand fonts or mocking font downloads would change or weaken the check, so neither was done. These runs do not establish successful production compilation or later build stages.

The Next navigation test was run through the scratch `task-6-next-launcher.cjs`, which loads the unmodified `scripts/editor-interactions.test.cjs` and changes only its fixture directory to this task's `task-6-next/` directory in memory. The pre-existing untracked `.next-verification/` was untouched. Real Next Back/Forward navigation, dirty-state cancellation and route integration remain unverified in this environment.

## MP4 evidence

The local fixture produces six seconds of red source footage with a 440 Hz tone. The draft retains source seconds 100–102 and 104–106, inserts a green photo at output 0.5–1 second, and places blue/yellow video over output 1–3 seconds. The removed source span advances the imported video's input time, so the picture changes from blue to yellow exactly at output 2 seconds. Imported video contains an 880 Hz tone that must not reach the export.

The actual HTTP route returned a four-second 270×480 H.264/AAC MP4. Assertions decode the entire video and sample thirteen times, including exact photo/video boundaries, the removed-source boundary, the hook's three-second end, and the caption's 3.5-second end. Caption and hook white pixels remain visible above imported visuals. Eight PCM windows confirm audible 440 Hz source energy before, during, and after imports. A Hann-windowed DFT measures 440 Hz and 880 Hz amplitudes independently and requires the imported/source amplitude ratio below 3% (about -30.5 dB), allowing AAC artifacts. Chrome decodes the returned MP4, seeks to 3.4 seconds, plays to `ended`, and reports no media error.

Retained local artifacts:

- `task-6-synthetic-export.mp4`
- `task-6-synthetic-export-probe.json`
- `task-6-export-caption-hook.png` — decoded at 1.5 seconds and visually inspected: blue imported picture, LOCAL FIXTURE hook, BEFORE CUT caption.
- `task-6-audio-spectral.json` — per-window 440/880 Hz amplitudes, ratios and RMS for the clean export and deliberately contaminated AAC control.

To retain fresh evidence, set `EDITOR_EXPORT_EVIDENCE_DIR` to the desired local directory before running the focused test. The fixture is synthetic verification footage and is not presented as a creator's clip. Automated PCM analysis establishes audio continuity; no subjective listening claim is made.

## Review fix — detect mixed imported audio

The review identified that zero-crossing frequency plus RMS can pass with an 880 Hz harmonic mixed into the 440 Hz source. This weakened the original imported-audio absence claim; the check is now frequency-specific and explicitly bounded by the 3% tolerance above.

RED: added a negative control that mixes the actual imported video's audio at 40% amplitude into the actual exported MP4, encodes AAC at 128 kbps, decodes PCM, and requires the same source-only assertion to reject four windows during the cutaway. With the previous zero-crossing/RMS assertion, the focused test failed at 1.1 seconds with `Missing expected exception` (`task-6-audio-red.txt`). This reproduces the review finding without changing production code.

GREEN: replaced zero-crossing counting with Hann-windowed sine/cosine correlation (DFT) at both fixture frequencies, retaining source-amplitude/RMS checks. The real export's maximum 880/440 amplitude ratio was **0.00000504**, below the **0.03** threshold. The contaminated AAC control's four ratios were **0.4009, 0.4027, 0.4020, 0.4087**; each triggered the specific imported-880-Hz assertion. The control additionally checks its measured contamination is between 25% and 55%, so accidental silence or a broken mix cannot make the negative control pass.

- Focused export MP4 test: **passed**, exit 0 (`task-6-audio-green.txt`).
- Full Node suite: **172 passed, 0 failed, 0 skipped**, exit 0 (`task-6-audio-tests.tap`).
- TypeScript: **passed**, exit 0, no diagnostics (`task-6-audio-tsc.txt`).
- No production changes; earlier build/localhost/live release limits remain unchanged.

## Mounted browser coverage and remaining release gates

The passing mounted editor test exercises photo/video selection, upload/probe progress, insertion, canvas picture pixels, save/reload, remove/undo, imported-video mute/synchronization, source volume/mute, signed-URL refresh/retry, source failure/retry, fit/focal settings, trim input offsets, actual MP4 sample-aspect-ratio handling, Pro gating, split/delete/undo, export pending state, transcript/ruler seeking, zoom, fully covered source touch selection and pointer trims, and responsive 44px controls. Service/auth/storage boundaries are fixtures, so this is not a deployed private-storage test.

Unverified and still required before marking the release complete:

- Apply migration 017 manually in the intended Supabase SQL Editor, then inspect its installed bucket/table/policies. No migration or live read/write was performed here.
- With a real owned saved clip, import a photo and video through signed private storage, save/reload, cut before an insert, preview, export, and inspect the downloaded MP4's picture/audio/caption/hook timing. No new VOD analysis or Sparks spending is authorized by these tests.
- Verify live cross-user denial, storage persistence after processing redeploy, archived-source fallback, missing assets and processing connectivity. Existing local tests cover helper and route behavior but do not prove deployed account/storage configuration.
- Rerun both deployment builds with functioning Google Fonts access and the Next navigation harness with permitted localhost access.
- Complete the parent-owned whole-branch review and draft PR update. Keep the PR draft until the authenticated real-clip and rendered-MP4 gate passes.

Deferred finding carried from Task 2: clip/account deletion can orphan verified private storage objects after cascading asset-row deletion. The setup note now calls this out for review; no cleanup design change was made in Task 6.

No migration CLI, live account operation, paid analysis, Sparks use, deployment, push, or PR update occurred. No subagent was spawned.

## Final branch review — one fix wave

Addressed the two Important findings and the media-list truncation finding:

- **Visual duration:** the probe now uses the selected visual stream duration. If the container omits it, a bounded FFprobe run reads that stream's presentation packet timestamps; missing/invalid timing rejects the upload. Container/audio duration is never used to extend the cutaway. Real MP4 and WebM fixtures with two seconds of blue picture and six seconds of audio previously reported 6000 ms (RED), and now report about 2000 ms. They reject a three-second placement and verify FFmpeg picture frames immediately before/after the accepted interval. The mounted `EditorCutawayPreview` draws the last blue picture at output frame 74 and removes its video at frame 75 (2.5 seconds), agreeing with the export even though the container still has audio.
- **Deletion cleanup:** migration 017 now creates an independent, service-role-only `editor_asset_cleanup` queue and a `SECURITY DEFINER` trigger with explicit search path. Every asset-row deletion—including clip/account FK cascades—records its immutable storage path. Cleanup waits until the later of the asset expiry or three hours after deletion, covering two-hour upload tokens plus a buffer. The processing sweeper removes storage objects before acknowledging manifests; storage/acknowledgement failures retain the queue entry. Service tests cover deleted verified/pending/failed manifests, token replay before the deadline, retry after storage failure, and idempotent retry after acknowledgement failure. Existing abandoned-upload and live verified-original tests still pass.
- **Asset library:** the repository reads all 200-row result pages with a stable tie breaker rather than truncating the library at 200. A 451-asset fixture previously returned 200 (RED); it now includes the oldest referenced asset. The test uses the actual Supabase query builder with only HTTP IO replaced.

Fresh checks for this wave:

| Check | Result | Evidence under `.superpowers/sdd/2026-10-23-polished-editor-media-import/` |
| --- | --- | --- |
| Full Node suite (`node --experimental-strip-types --test --test-reporter=tap lib/*.test.ts tests/*.test.mjs`) | 180 passed, 0 failed, 0 skipped; exit 0 | `final-fix-tests.tap` |
| TypeScript (`npx tsc --noEmit`) | Pass, exit 0, no diagnostics | `final-fix-tsc.txt` |
| Mounted media browser suite | 9/9 passed, exit 0 | `final-fix-media-browser.txt` |
| Mounted import browser suite | Pass, exit 0 | `final-fix-import-browser.txt` |
| Mounted composition browser suite | Pass, exit 0 | `final-fix-composition-browser.txt` |
| New real audio-tail/browser/export boundary regression | Pass for MP4 and WebM | `final-fix-boundary-browser.txt` |
| Git whitespace check | Pass | `git diff --check` |

RED/GREEN evidence: `final-fix-duration-red.txt`, `final-fix-timestamps-red.txt`, `final-fix-duration-green.txt`, `final-fix-cleanup-red.txt`, `final-fix-cleanup-green.txt`, `final-fix-pagination-red.txt`, `final-fix-pagination-green.txt`. Initial TypeScript checks caught missing source-anchor fields and one callback annotation in the new test harness; fixed before the full passing run. The first mounted boundary harness omitted React's `jsxs` helper and timed out; corrected the harness and both actual formats passed. Existing Node module-type warnings remain baseline noise.

**Limits:** migration 017 remains unapplied. No local PostgreSQL runtime was available; installing PGlite was blocked by npm registry DNS (`ENOTFOUND`) and changed no dependencies. `supabase/tests/017_editor_media_cleanup.sql` provides rollback-only tests for all nine asset/clip/account × verified/pending/failed deletion cases, queue retention, permissions, and token-expiry delay, but **was not executed**. The service tests use persisted queue fixtures and do not prove installed database triggers, actual signed-token replay, live RLS or Storage API behavior. Verify those in a test Supabase project after manual application. Cleanup is eventual, in batches of 100 per 15-minute sweep, and requires a running processing worker; overdue queue rows and worker errors need operational monitoring.

The earlier orphan-cleanup deferral is addressed by this implementation, subject to the SQL/live verification above. Previous Google Fonts build and localhost Next-navigation blockers were not rerun in this fix wave and remain release gates, as do authenticated owned-clip import/save/reload/export and live MP4 inspection. No migration, deployment, paid analysis, Sparks use, push, merge, or `.next-verification` modification occurred.
