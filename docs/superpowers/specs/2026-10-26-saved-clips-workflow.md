# Saved Clips and Found Moments workflow

The user supplied the approved product requirements in chat on 2026-10-26. This document records the implementation choices grounded in the existing app.

- A raw download is the detected moment's original source window, at its original dimensions with source audio. Existing graphics burned into the VOD remain. Klyp never adds captions, hook, layout, watermark, polish, or imported media. It costs no additional Sparks. The processing service reuses the archived master when present and otherwise downloads the source window.
- Raw is independent of a saved editor draft. A saved moment uses its canonical database URL and start/end, even if its draft trims or rearranges footage. Unsaved analysis results require an exact previously analyzed window. Authentication and concurrency limits remain.
- A new timeline draft starts with the original source, an empty hook, and no caption cues. The underlying transcript stays available so users can add captions deliberately. Existing saved drafts remain unchanged. Saving edits keeps the source row immutable.
- Saved cards on dashboard and Found Moments use real thumbnails, duration, title, source, original VOD time, optional category, Edit Clip and Download Raw. Additional actions are in a compact menu; feedback and deletion remain available.
- Preview shows the raw detected window, title and metadata. Edit Clip and Download Raw are prominent, Watch Original is secondary, details collapsed. Desktop height is bounded and mobile scrolls naturally.
- Unsaved results offer Preview, Download Raw, and Edit Clip. Edit Clip first saves that moment without another Sparks charge, then opens its exact timeline route.
- Keep the existing dark and mint design, billing for analysis and premium editing, authentication, navigation, and existing timeline features. Do not add imagery or fake metrics.

Known limits: downloaded MP4 may re-encode video/audio to ensure browser-compatible output; exact timestamps are passed to FFmpeg but frames remain limited by source frame rate. A deleted VOD without a stored archive cannot be recovered; show a clear error.
