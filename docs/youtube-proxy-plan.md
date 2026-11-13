# YouTube for Pro users: proxy build plan (not started)

Written Nov 12, 2026. Nothing here is built. YouTube links are OFF for everyone right now (branch `youtube-off`, switch `NEXT_PUBLIC_YOUTUBE_ENABLED`).

## Why
YouTube blocks the Railway server's address ("Sign in to confirm you're not a bot"). Same video loads fine from a home connection. In the 3 days before Nov 12: 0 of 30 saved YouTube clips backed up; Twitch and Kick 17 of 17. A free "token plugin" was judged unlikely to help, because the block is on the address.

## Goal
Pro accounts can use YouTube links. Free accounts see "YouTube is a Pro feature". The proxy bill is $0 until someone pays.

## Numbers (my estimates, check real prices)
- Residential proxy: about $3 to $8 per GB (assumption, not a quote).
- Typical Pro user, about 10 videos a month: about 1.3 GB, so $4 to $10 of proxy; with the savings below, about 0.3 to 0.5 GB, so $1 to $4.
- Pro is $28. After Klyp's cost (about $4), Stripe and proxy, about $13 to $18 is kept per Pro user.

## Steps
1. **Test first (small).** Buy the smallest pay-per-GB plan from one provider. Run one YouTube video through it from the Railway service and confirm it gets past the block. If it does not, stop here.
2. **Proxy only for Pro, only after a block.** Try the normal route first; on a bot-check error, retry once through the proxy. Free accounts never use it.
3. **Keep clips in storage.** The first time a Pro user opens or saves a YouTube clip, store it (the clip backup already does this), so later previews and downloads cost no proxy data.
4. **Fetch small.** 480p previews, lowest-quality audio for analysis, only the clip slice, never the whole video.
5. **Cap per user.** A monthly YouTube data allowance per Pro account, so nobody can run up the bill.
6. **Switch it on.** Set `NEXT_PUBLIC_YOUTUBE_ENABLED=1` on both Vercel and Railway and redeploy both, and show the Pro-only message to Free accounts on YouTube links.
7. **Watch it for a week.** Check the proxy bill against the number of Pro users, and the share of YouTube clips that back up.

## Decide before building
- Which provider (pay-per-GB first; flat monthly only once there are many Pro users).
- The monthly data allowance per Pro account.
- Whether Free accounts get one free YouTube video a month as a taste (costs a little proxy data).

## Where the code is
- `lib/youtube-switch.ts` (the on/off switch and the message)
- `lib/bin.ts` (`runYtDlpWithRetry`, `runYtDlpCaptureWithIpv6Fallback`: where a proxy argument would go)
- `lib/video-cache.ts` (`resolveSourceSegment`: segment downloads)
- `lib/clip-archive-worker.ts` (clip backup)
- `lib/youtube-block-memory.ts` (the 10-minute cooldown after a block)
