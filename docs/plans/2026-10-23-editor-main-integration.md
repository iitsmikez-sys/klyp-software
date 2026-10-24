# Editor integration into current main

Starting point: `e974bea` (released editor #20 and repeat-VOD billing #10).
Incoming stack: published `cf5861f`, expected tree identical to local `a74d246`.
Scope: local integration and verification only. Deployment, SQL application, remote
pushes, service changes, spending Sparks, and worktree deletion are excluded.

1. Record main baseline tests and dependency/tool availability.
2. Merge the complete editor stack with a merge commit. Use the V3 editor as the
   active workspace; retain main billing, archive timing, free Original export,
   caption color/position compatibility, and CORS headers. Preserve old helpers
   where existing clients and regression tests still use them.
3. Keep main migrations 014/015 intact. Number incoming vertical layout 016 and
   editor media 017; retain incoming draft 013 and update all references. SQL
   numbering is repository order, not evidence of production application.
4. Add targeted regression coverage for integration seams before resolving them.
   Run Node suites, TypeScript, mounted browser tests, FFmpeg integration tests,
   and production build when local dependencies permit.
5. Record exact verification, failures and deployment prerequisites, inspect the
   final diff, and commit the integration locally for parent review.

## Review focus

Fractional archive offsets must agree between preview and export. Both legacy
caption options and V3 cue layout must remain functional. Free Original export
must remain accessible. Private media ownership, durable cleanup, V3 drafts and
preview/export parity must survive the merge. Main billing migrations and API
protections must remain unchanged.

## Evidence

No AGENTS.md exists in this checkout or its ancestor directories. Baseline and
final outcomes will be recorded in the integration report under docs.
