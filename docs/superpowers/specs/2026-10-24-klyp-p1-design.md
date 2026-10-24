# Klyp P1 post-ready editor design

## Intent

Let a livestream creator finish a short clip inside Klyp, with a polished result that matches the editor preview. P0 already provides owned saved clips, a timeline, split/trim/delete, imported images and video, synced drafts, manual layouts, and three original animated caption styles. P1 extends that editor instead of adding a second editing path.

## User outcomes

1. Choose a caption *template* by seeing a short visual sample, then adjust a safe font family, color, and position. Preserve current drafts and support existing styles. Do not copy CapCut or OpusClip templates or assets.
2. Review proposed filler words and quiet pauses on the transcript and apply cuts with one action. Never silently remove context; show the removed duration before committing and keep undo available.
3. Apply a bounded speech polish option to exported audio, with a clear on/off state. The editor preview should indicate the option and approximate the result where browser support allows; it must never unexpectedly process raw/original exports.
4. Ask Klyp to suggest a vertical frame for a saved clip. Sample a small number of frames, look for a stable speaker or gameplay region, and show the proposed crop before applying it. Manual layout controls always remain available. If a subject cannot be located reliably, keep the current layout.

## Constraints

- Next.js 16, React 19, Supabase, FFmpeg, and the existing Railway/Vercel split remain in place.
- Editing stays scoped to an owned saved clip; Pro access is enforced on server export and recommendation routes.
- Drafts written by older clients must load with safe defaults. New fields are validated before they reach FFmpeg or CSS.
- Process at most a few downscaled frames per auto-frame request and bound model time/cost. Never promise perfect tracking from a sparse sample.
- Caption, audio, cut, and framing settings must survive save/reload and feed both preview and export.
- Preserve native-framed Free Original exports and existing P0 access limits.

## Approach

Extend the V3 draft with optional bounded P1 appearance, audio, and auto-frame settings. Keep the source-timeline segments as the sole definition of retained footage. Use pure helpers for cleanup candidates and FFmpeg filters, the existing canvas preview for caption/framing parity, and a single owned auto-frame suggestion endpoint with a cost cap. Present the new controls in a clearer right-hand inspector with template cards and a separate quick-cleanup section in the transcript panel.

## Alternatives considered

- Replacing the editor with a new component would lose migration and export work. Extend the current editor.
- A server-wide AI edit step for every clip would add cost and delay. Run on demand and allow rejection.
- A fixed center crop is cheap but fails stream layouts. Suggest a bounded region from sampled frames, then let the creator adjust it.

## Release evidence

Red/green helper tests, real FFmpeg caption/audio/framing renders, draft and route tests, responsive browser interaction checks, full unit/typecheck/build, and a production preview. Publish only after preview and export agree on representative Gaming and IRL footage.
