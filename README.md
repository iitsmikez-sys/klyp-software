# Klyp — AI Video Clipping for Streamers

Klyp watches streamer VODs and uses AI to find, score, and (eventually) cut the most clippable moments.

**Current stage:** analysis + cutting. `/api/analyze` finds the 5 best clippable moments; `/api/clip` cuts each one into a 9:16 vertical MP4 you can download from the dashboard.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install yt-dlp and FFmpeg

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
```

(macOS: `brew install yt-dlp ffmpeg` · Linux: `pip install yt-dlp` + your package manager's ffmpeg)

Restart your terminal/dev server after installing. If the server can't find the binaries (stale PATH), set absolute paths in `.env.local`:

```
YTDLP_PATH=C:\path\to\yt-dlp.exe
FFMPEG_PATH=C:\path\to\ffmpeg.exe
```

### 3. API keys

Copy `.env.example` to `.env.local` and fill in:

| Key | What it's for | Where to get it |
|---|---|---|
| `ASSEMBLYAI_API_KEY` | Speech-to-text with word-level timestamps | [assemblyai.com/dashboard](https://www.assemblyai.com/dashboard) — free tier includes ~100 hours |
| `ANTHROPIC_API_KEY` | Claude API — finds & scores clippable moments | [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys) |

### 4. Run

```bash
npm run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard), paste a YouTube or Twitch VOD URL, and hit **Find clips**.

## How the pipeline works

```
VOD URL
  └─► yt-dlp ──────────── downloads audio-only (no re-encode, temp dir)
        └─► AssemblyAI ── transcribes with word-level timestamps
              └─► Claude (claude-opus-4-8) ── reads the timestamped transcript,
                    returns 5 clips as structured JSON:
                    { start_seconds, end_seconds, type, viral_score, title, caption, reason }
```

Clip types: `CLUTCH` · `FUNNY` · `RAGE` · `UNHINGED` · `HIGHLIGHT`

Key files:

- `app/api/analyze/route.ts` — the pipeline (download → transcribe → analyze)
- `lib/clips.ts` — shared types + the zod schema that constrains Claude's output
- `components/AnalyzePanel.tsx` — dashboard UI (URL input + clip cards)

## Costs (rough)

- **AssemblyAI**: ~$0.12/hour of audio (free tier covers initial testing)
- **Claude**: a 2-hour VOD transcript is roughly 25-40K input tokens ≈ $0.15-0.25 per analysis on Opus 4.8

## Deployment note

`/api/analyze` spawns a `yt-dlp` child process, so it runs in local dev or on any Node server — but **not on Vercel serverless**. When we build the actual video cutting stage, download/processing will move to a worker service (e.g. a small VPS, Railway, or a queue + container setup), and the Next.js app will just orchestrate.

## Stage 2: cutting (`/api/clip`)

```
{ url, start_seconds, end_seconds, title }
  └─► yt-dlp ── downloads the full video once (≤1080p MP4, cached per URL in temp dir)
        └─► FFmpeg ── seeks to start, cuts the duration, scales + center-crops
              to 1080x1920 (9:16), H.264 + AAC, faststart
                └─► streamed back as an MP4 download
```

The source video is cached, so downloading all 5 clips from one VOD only fetches the video once — the first clip is slow, the rest are fast.

## Roadmap

- [x] Stage 1 — analysis brain (transcribe + find moments)
- [x] Stage 2 — video cutting (ffmpeg, 9:16 vertical crop, MP4 download)
- [ ] Stage 3 — caption rendering & smart reframe (face/action tracking)
- [ ] Auth, persistence, billing
