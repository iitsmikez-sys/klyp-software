# Cheaper transcription with DeepInfra

DeepInfra hosts the same Whisper turbo model Groq does, at about **$0.012 an hour** (AssemblyAI is $0.15). It is built
and OFF. Nothing changes until you set the two variables below.

## How it works
- The audio is cut into 20 minute chunks and sent to DeepInfra (same code path as the Groq option, `lib/groq-transcribe.ts`).
- Whisper sometimes gets stuck and writes one word dozens of times ("Run. Run. Run." 119 times in a row). That can wipe out the
  best moment. Every loop is found (`lib/whisper-loops.ts`) and just that stretch is re-transcribed by AssemblyAI (about a quarter
  of a cent a minute). A loop that cannot be repaired is trimmed to three repeats.
- If DeepInfra fails (no balance, outage, rate limit) or hears no speech, the whole file goes to AssemblyAI as before.

## What the tests showed (two real Twitch VODs, 30 minutes each)
- 10 minutes of audio: DeepInfra 8.8 seconds, about $0.002. Word times match AssemblyAI's: median gap 0.15 s, 90% within 0.6 s.
- Clip finder, 4 runs each: DeepInfra 3, 5, 4, 4 clips (average 4.0); AssemblyAI 4, 5, 5, 4 (average 4.5). Top moments mostly the same.
- One VOD had a loop at 22:10 that hid the best moment. With the loop repair the transcript came out clean (5,492 words vs
  AssemblyAI's 5,508).

## Turn it on (Railway only, the processing service)
1. Add `DEEPINFRA_API_KEY` (a key from deepinfra.com, Keys page; the account needs a positive balance).
2. Add `TRANSCRIPTION_PROVIDER=deepinfra-free` to move **Free accounts only**. Pro stays on AssemblyAI.
   Later, `TRANSCRIPTION_PROVIDER=deepinfra` moves everyone.
3. Redeploy. To turn it off, remove `TRANSCRIPTION_PROVIDER` (or set it to `assemblyai`).

## What to watch
- DeepInfra balance: at 20 hours of audio a day it is about $0.25 a day. If it runs out, jobs quietly use AssemblyAI.
- Railway logs: `[transcribe] DeepInfra: N loop(s) found, M of N stretch(es) repaired with AssemblyAI` and
  `[transcribe] DeepInfra failed, using AssemblyAI`.
- Costs per run are recorded as provider `deepinfra` in `[provider-usage]` lines.
