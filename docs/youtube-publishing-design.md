# Pro YouTube publishing

Klyp users with a confirmed Pro subscription can upload a finished clip to their own YouTube channel immediately or schedule its publication. Free users keep the editor and export but cannot connect or publish through this feature. No Sparks are charged for publishing.

## Flow

1. The user connects YouTube with Google's OAuth authorization-code flow and the `youtube.upload` scope. Klyp requests offline access so a scheduled upload can finish if the initial access token expires. A random state cookie binds the callback to the initiating browser. The refresh token is encrypted at rest; only server code and the service role can read it.
2. In the clip editor, the user reviews the final clip, enters a YouTube title and description, then chooses Post now or Schedule. The current edit draft is rendered by the existing processing service with the confirmed Pro watermark behavior.
3. Klyp uploads the rendered MP4 to YouTube immediately. For Schedule, it uploads as private with YouTube's `status.publishAt`; YouTube stores the video and releases it at the chosen time. Klyp does not need a separate delayed upload worker or duplicate stored MP4.
4. Klyp records the YouTube video ID, intended time, and status, and returns the YouTube link. A stable request ID prevents a double click from creating two posts. Ambiguous upload outcomes must not be retried automatically. If a process dies, the user can explicitly clear an unresolved post after one hour only after checking their YouTube channel for a duplicate.

## Boundaries

- Server-side subscription check requires both `tier=pro` and a non-null confirmed Stripe subscription ID.
- The publishing route accepts only an owned saved clip and uses the existing validated render path. It never trusts the browser's tier or a client-supplied rendered file.
- No production deploy, Google OAuth connection, upload, or paid AI call is part of local implementation and tests.
- The Google OAuth client ID, client secret, token encryption key, and redirect URI must be configured before live verification. A real private test upload is required before launch.
- Scheduled publication must be at least 30 minutes ahead when requested and again immediately before upload. The upload has a 10-minute timeout; if it completes too close to the publish time, Klyp marks it for review rather than claiming success.

## Current architecture constraint

The editor's export currently sends a rendered MP4 back to the browser and deletes its temporary file. The publishing route must render and upload in one processing-service request. This avoids losing a scheduled clip after container replacement and avoids storing duplicate finished MP4 files.

## Manual setup before launch

1. Create a Google Cloud project, enable YouTube Data API v3, configure OAuth consent, and create a Web application OAuth client. Add the production callback URI `https://www.klyp.world/api/youtube/callback` and a separate staging URI for staging tests.
2. Generate one random base64-encoded 32-byte token key. Configure the same `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, and `YOUTUBE_TOKEN_ENCRYPTION_KEY` on the frontend and processing service. Keep all four server-only.
3. Apply migration `034_youtube_publishing.sql` in staging, test the authorization-code callback, revoke/reconnect, a private test upload, and a future scheduled upload. Confirm user ownership, Free rejection, duplicate prevention, and visibility on YouTube.
4. Run a clean production build and then apply migration 034 to production before deployment. Do not expose the new UI or routes until both deployments have the required configuration.

## Known limits

- A YouTube upload may finish but its media may still be processing. `uploaded` means YouTube returned a video ID, not that viewers can already watch it.
- A network failure during the final upload may be ambiguous. Klyp blocks an automatic retry; the user must check their YouTube channel first.
- The current route buffers the finished MP4 and caps it at 256 MiB. Large clips need a future streaming render/upload path.
