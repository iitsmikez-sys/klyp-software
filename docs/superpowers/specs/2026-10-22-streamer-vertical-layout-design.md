# Streamer vertical clip layout

## Goal

Make Klyp's vertical clips useful for streamers whose 16:9 VOD contains gameplay, a facecam, and sometimes chat. A creator marks the important regions once, sees the actual 9:16 composition before export, and can correct one clip when the scene changes. The moment's payoff must remain visible and captions must not cover the facecam or chat. This is the first step toward a separate after-stream review batch. It does not change how Klyp finds candidate moments.

## Release boundary

This release covers a reusable account layout, optional per-clip adjustment, a matching vertical preview and MP4 export, and a safe fallback. It uses chat already visible in the VOD; it does not fetch or draw individual Twitch chat messages. It does not promise automatic face detection, action tracking, direct posting, or an after-stream batch yet. The batch will build on the existing auto-clipping worker after this layout works reliably.

The work is a separate branch and stacked pull request based on saved-editor PR #9. The saved editor is still a draft and supplies the per-clip draft and trim controls. No work is pushed to `main`. Supabase SQL is supplied as a separate migration for the user to apply by hand in the SQL editor.

## Creator flow

1. From a saved clip or account settings, open **Vertical layout** and pause a representative VOD frame. The creator marks a gameplay focus box, an optional facecam box, and an optional embedded-chat box. The boxes are constrained to the source frame and stored as normalized coordinates, so 720p and 1080p recordings of the same layout behave alike.
2. A 9:16 preview shows the composed frame: gameplay is dominant; optional facecam and chat occupy separate lower panels. The editor labels the panels and lets the creator move/resize source boxes. Text overlays use reserved safe areas.
3. **Save as my layout** makes those choices the account default for future clips on either tier. A Pro creator can instead adjust just this clip and save that override with the existing Pro edit draft. Changing the account default never silently rewrites an older clip's saved override.
4. Export renders the same composition as the preview, with the original clip audio, selected trim, hook, captions, watermark and existing format choices. `Original`, 1:1 and 16:9 continue using their existing framing. Raw export remains untouched.
5. With no saved layout, the 9:16 output fits the full source frame on a neutral background. It shows the whole action while inviting the creator to set a layout. If an optional facecam/chat region is disabled, gameplay takes that space. Invalid saved geometry is rejected on save; legacy or unsupported layout data falls back with a visible warning rather than producing a broken export.

## Data and boundaries

- Add a versioned `vertical_layout` JSONB value to `profiles` for the account default. It contains normalized source rectangles for gameplay, facecam, and chat, plus enabled flags. Its validator enforces finite coordinates, minimum sizes, and containment in the source frame. The authenticated owner may read/write their own layout. No user can alter another account's layout.
- Extend the saved clip draft contract with an optional layout override. Existing version-1 drafts without it remain valid. `null` means inherit the current account default; an explicit versioned layout freezes this clip's choice. A saved override is included in the export payload, while the server validates all incoming geometry again.
- A pure layout planner turns source dimensions and validated normalized rectangles into output crop/panel coordinates. Both the browser preview and FFmpeg filter builder consume the same plan. FFmpeg uses one source stream, splits it into region crops, composes them into 1080×1920, then applies existing hook/caption/handle/watermark filters. Audio follows the untouched source stream.
- Keep the renderer separate from billing and clip selection. The existing Sparks charge and archive/source fallback paths remain authoritative. A layout save does not consume Sparks; an export follows current charging rules.

## Quality and failure handling

- The primary gameplay panel must preserve the chosen action region at the clip's payoff. The creator can pause at the payoff and adjust its box; this release does not infer the payoff's screen coordinates automatically.
- Facecam and embedded chat are optional. The UI should warn when a marked chat box is so small that it will likely be unreadable after scaling, and let the creator disable it.
- Preview and export should agree on panel bounds and source crops. Rendering or probe errors should show a retryable message without replacing the saved layout or charging for a failed output. Unsupported source geometry uses the full-frame fallback.
- Compare a synthetic 16:9 test video with colored gameplay/facecam/chat areas against the rendered 9:16 result. Test normalized-coordinate validation, absent panels, an invalid/legacy layout, saved override precedence, source dimensions, caption safe areas, and archived clip export. Run TypeScript and a production build. A real licensed or creator-owned VOD is needed for a final visual check before this PR is considered ready to merge.

## Next feature: after-stream review batch

Once vertical rendering is verified, group the existing auto-clipped candidates by VOD, rank a small set (initially three) for the creator, show playable previews and reasons, and provide keep/discard/edit actions. This will have its own design and pull request so layout correctness can be reviewed independently. Direct social posting and scheduling come later.
