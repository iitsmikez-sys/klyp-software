# Google verification for "Schedule to YouTube"

Klyp asks for one Google permission: `https://www.googleapis.com/auth/youtube.upload`. Google treats it as a
sensitive permission, so until Klyp is verified every customer sees "Google hasn't verified this app".
Google's rules change, so check the current requirements at https://support.google.com/cloud/answer/13463073
before submitting.

## Where things stand

- The button, connection, upload and scheduling are built. A private test upload from the owner's account worked.
- Until Google verifies the app, only **complimentary-Pro accounts** (the owner's) can use it. Everyone else sees
  "YouTube scheduling is coming soon" and is never sent to Google's warning screen.
- When Google approves, set `YOUTUBE_PUBLISHING=public` on both Vercel and Railway and redeploy. That opens it to every Pro member.

## Use it on your own channel now

1. Google Cloud Console, then **APIs and services**, then **OAuth consent screen**.
2. If the status is **Testing**, Google expires the connection every 7 days. Click **Publish app** to move it to
   **In production**. It stays unverified (about 100 people can connect, with the warning), but your connection no longer expires.
3. In Klyp, click Schedule post. On Google's screen choose **Advanced**, then **Go to klyp (unsafe)**, then **Continue**.

## What to fill in on the consent screen

| Field | Value |
|---|---|
| App name | Klyp |
| User support email | your support email |
| App home page | https://www.klyp.world |
| Privacy policy | https://www.klyp.world/privacy (already mentions YouTube and the Limited Use rules) |
| Terms of service | optional; leave blank or add a page later |
| Authorized domain | klyp.world (verify it in Google Search Console first) |
| App logo | the Klyp logo, square, at least 120 px |
| Scope | only `youtube.upload` |

## Why Klyp needs the permission (paste this into the form)

> Klyp turns long streams into short vertical clips. After a user finishes editing a clip, they can choose
> "Schedule to YouTube". Klyp then uploads that one clip to the user's own YouTube channel as a private video
> with a publish time the user chose. Klyp uses the youtube.upload permission only for that upload. It does not
> read, list, change or delete anything else on the user's channel, and it does not use the data for advertising
> or AI training. Users can disconnect at any time in the publishing dialog, which revokes the permission.

## Demo video Google asks for (2 to 3 minutes, screen recording, unlisted on YouTube)

1. Show klyp.world and sign in with a Pro account.
2. Open a saved clip and click **Schedule post**.
3. Click **Connect YouTube**. Keep the Google consent screen on screen long enough to read the permission, with the
   address bar showing the real OAuth client.
4. Back in Klyp, set a title, description and a publish time, then click Schedule.
5. Show the video arriving in YouTube Studio as a private, scheduled video.
6. Click **Disconnect** in the dialog and show the permission is removed.

## Separate step: YouTube API compliance review

Google may also restrict videos uploaded through a new, unreviewed YouTube API project to private. If scheduled
test videos never go public, apply for the **YouTube API Services audit** from the Google Cloud Console project
(the form is called the compliance audit). Approval is on Google's side and can take weeks.

## Checklist before you submit

- [ ] klyp.world verified in Google Search Console
- [ ] Consent screen filled in with the values above
- [ ] Only the `youtube.upload` scope is requested
- [ ] Demo video recorded and uploaded as unlisted
- [ ] Privacy policy page loads without signing in
- [ ] A scheduled test upload from your own account has been checked in YouTube Studio
