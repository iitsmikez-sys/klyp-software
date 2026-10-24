# Klyp editor polish and working media import

## Intent

Make Klyp's saved-clip editor feel like the polished, direct editor in the user's second reference image. Streamers should see and hear their real vertical clip, find an exact moment in the transcript or timeline, change cuts and captions, add a short photo or video cutaway, save, and export what they reviewed. The current dense layout, black loading area, tiny green timeline blocks, and weak media buttons do not meet that goal.

The user's supplied reference image is the visual target, not a source of footage or a replacement brand. Keep the real lowercase **klyp** mark used on Klyp's dashboard, which the user previously identified as their logo. Use the reference's hierarchy: generous central portrait preview, readable transcript, clear right inspector, restrained dark surfaces, mint active state, blue video blocks with real frames, green caption blocks, visible audio waveform, and purple hook/imported-media blocks. No illustrative facecam, fake waveform, fake thumbnail, or unsupported control may appear as if it is user footage.

## What the user chose

- Build a **working photo and video import now**, including preview, saved draft, and final export.
- An imported asset **replaces the picture** over its interval; the original stream audio continues. This makes the imported clip a visual cutaway. The first version mutes imported video audio.
- A cutaway follows the original stream moment it covers. Removing earlier footage moves it earlier on the output timeline; removing the covered footage shortens or removes the cutaway rather than leaving it over an unrelated moment.
- Rebuild Klyp's editor screen around its existing cut, caption, vertical-layout, save, and export engine. Do not replace those systems with a generic third-party editor.

## Approaches considered

1. **Rebuild the editor screen around the existing engine (chosen).** Keeps working split/delete, captions, saved drafts, ownership checks, and FFmpeg export; adds durable media assets and a visual layer. More Klyp-specific UI work, but best match to the reference and existing behavior.
2. **Adopt a third-party timeline editor.** Could provide drag controls quickly, but would still require custom integration with saved drafts, vertical layouts, processing service, and billing gates. Its default appearance would work against the visual target.

Styling the current page alone was rejected because it would leave Add photo/video nonfunctional. Reusing the current temporary VOD upload was rejected because those files disappear after a server restart and would break saved drafts.

## Screen and interaction

1. Open the editor from a saved clip. The desktop layout has a compact top bar with the correct logo, editable title, server-confirmed save state, aspect ratio, and Export. A narrow left rail switches between **Transcript** and **Media**. The transcript has legible timestamped rows and search; selecting a row seeks the actual clip. Media shows imported assets and clear Add photo / Add video actions. A responsive layout keeps core playback and editing reachable on smaller screens.
2. The center gives the 9:16 canvas the most attention. Render the creator's actual footage and existing facecam/gameplay/chat layout. Show a poster or progress state while a proxy loads. If the source cannot load, show a specific, retryable error; never leave an unexplained black rectangle. Transport, volume, time, and play/pause work against the edited timeline.
3. The right inspector separates **Edit** and **Style**. Edit shows the selected video cut, caption, or imported item, with only applicable controls. Style retains working hook and caption presets, color, and position. Keep the existing Free/Pro gate and format rules unless a separately approved pricing decision changes them.
4. The bottom timeline has a ruler, draggable playhead, zoom, video thumbnails, caption blocks, actual audio waveform or an honest unavailable state, and hook lane. Imported cutaways are distinct purple video-lane blocks. Track widths follow actual output time. Selection, Split, Delete, trim, undo/redo, keyboard play, and seeking must stay synchronized with the preview and exported result.
5. Add photo/video opens a file picker and displays upload/probe progress. A photo defaults to a three-second cutaway at the playhead; a video defaults to its usable duration, bounded by the clip's remaining output. The creator can reposition and trim the interval without changing the total clip length. Remove/undo restores the underlying picture. Stream audio, captions, and hook timing continue through the cutaway. An imported video plays muted in preview and export. Fit defaults to cover with a position adjustment so important action is not cropped accidentally. Cutaways move with the source moment when earlier footage is deleted.
6. Save only reports success after the server accepts the draft and its referenced assets exist. Exports render the current visible draft, including unsaved edits, with the same media timing, crop, captions, hook, and source audio. Failures leave the draft intact and give a useful retry action. Imported assets in a saved draft survive browser reload and processing-service redeploy.

## Data and rendering

- Add a compatible versioned editor draft with visual cutaways `{id, asset_id, source_start_ms, source_end_ms, asset_in_ms, fit, focal_point}` anchored to original stream time. Map those anchors through the kept source segments to output time; an earlier ripple cut shifts the rendered cutaway and deletion of its covered source span shortens or removes it. Preserve V1/V2 drafts and existing source-time segment/caption mapping. Limit cutaways, file size, duration, total output length, and overlap; validate on both client and server. Treat overlapping cutaways as invalid in the first release.
- Put creator uploads in a **private persistent storage bucket**, separate from the processing server's temporary VOD cache. A new asset record binds storage path, kind, media metadata, creator, and saved clip. Only the owner may obtain short-lived preview URLs, place the asset in that clip's draft, or render it. The browser may upload directly with a short-lived signed upload URL; the server verifies actual media, not only extension or client-reported duration. Failed or abandoned uploads need cleanup.
- Keep rendering source cuts and source audio through the existing editor path. Composite the selected photo/video over the visual track for each cutaway interval, below captions and hook. Use the same normalized interval and crop data in browser preview and FFmpeg export. Audio does not switch to the imported video's audio. Test boundaries at start/end, deleted source spans, and cutaway intervals crossing a segment cut.
- A separate numbered Supabase migration creates the private asset bucket and ownership data/policies. The user applies migrations in the Supabase SQL editor; do not run a CLI migration. The app must handle a missing migration/bucket with a clear unavailable error.
- Keep imported originals and derived previews bounded. Do not store assets in `CACHE_DIR` as their durable copy. Use real frame thumbnails from the media and actual waveform from source audio when available.

## Release checks

Verify an owned clip can import a photo and video, seek and play across each cutaway, reload the saved draft, undo/delete an insert, export an MP4, and see the same timing and picture in the result. Verify ownership denial, invalid/oversize uploads, missing asset, archived-source playback, source-unavailable error, legacy drafts, and responsive layout. Run TypeScript, relevant tests, and deployment build. Keep this on a draft PR until an authenticated real-clip browser test and exported MP4 inspection pass. Do not analyze a new VOD or spend Sparks to test without the user's consent.

## Builder calls settled for the first release

Use a 10 MB photo cap (JPEG, PNG, WebP), a 50 MB/60-second video cap (MP4, MOV, WebM), at most 12 cutaways, and the existing 180-second output cap. The server verifies decodable video/image streams before finalizing an asset. Use the existing design tokens and icon set; preserve preview/export parity over decorative accuracy. The current screenshots may be from a different build: the working PR does not contain the screenshot's Add video button, so the actual code is the source of truth for behavior and the supplied reference is the source of truth for appearance.
