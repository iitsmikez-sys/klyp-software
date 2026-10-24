# Stage 4 verification

## Executed
- 63 automated tests passed: thumbnails (deadline, retry, invalid response, fractional ranges, deduplication), charge summaries, billing/history, permissions, captions, trims, media and FFmpeg integration.
- Local Playwright flow passed for Free and Pro fixtures, with no page runtime errors.
- Browser checks: thumbnail 503 then retry; export 500 then retry; hook and caption color/position retained in export requests; Original format; square/wide Pro selection and Free denial; watermark drawn only for Free; storage-disabled reopen; Keep failure/retry; Discard; zero/one/multiple results; desktop/mobile overflow; duplicate export prevention after closing.
- Existing FFmpeg tests generated and probed real local video outputs covering cut/insert/overlay composition, captions/hooks, audio stream presence and duration.

## Fix
The editor previously omitted the Free export watermark from its preview. Added canvas watermark rendering with the export timing and coordinate model, plus explicit Free export notice. Original-format watermark size remains approximate because the preview proxy does not provide the original source resolution.

## Boundaries
The browser tests intercept auth, analysis, saving and export services. They do not validate production sign-in, real charge debits, remote render availability or actual subscription accounts. No production deployment was performed. Canvas and FFmpeg text rendering may differ in font metrics and wrapping; pixel-perfect parity is not certified. A real saved clip export on the deployed preview remains a release check.

## Reproduce
Start Next on 127.0.0.1:3018 with fixture NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co and dummy NEXT_PUBLIC_SUPABASE_ANON_KEY. Run node tests/results-editor-browser.cjs; repeat with KLYP_TEST_TIER=pro. Fixture route is removed after each run.
