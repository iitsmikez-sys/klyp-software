/**
 * Loud moments in a stream's audio: explosions, screams, big fights, crowd noise. A quiet streamer with great
 * gameplay says little, so the transcript alone finds few clips; sudden jumps in volume are a free extra
 * signal. The audio is measured with FFmpeg's EBU R128 loudness meter, every 100 ms, and a moment is a stretch
 * that is well above the stream's usual volume. The result is handed to Claude as hints for Gaming VODs.
 */

export type LoudSample = { t: number; m: number };
export type LoudMoment = { start_seconds: number; end_seconds: number; peak_seconds: number; lift_db: number };

/** How far above the stream's usual loudness a second must be to count, in decibels. */
export const LOUD_LIFT_DB = 8;
const MERGE_GAP_SECONDS = 6;
/** About one hint every 3 minutes of video, between 5 and 20, so a 20-minute stream gets about 7 and not 20. */
export const maxMomentsFor = (durationSeconds: number) => Math.min(20, Math.max(5, Math.ceil(durationSeconds / 180)));
/** Below this the meter is reading silence, not a quiet voice. */
const SILENCE_FLOOR = -60;

/** Parse FFmpeg's `ametadata=print` output: "pts_time:12.3" lines followed by "lavfi.r128.M=-21.5". */
export function parseLoudnessMetadata(text: string): LoudSample[] {
  const samples: LoudSample[] = [];
  let t: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const time = /pts_time:([0-9.]+)/.exec(line);
    if (time) { t = Number(time[1]); continue; }
    const m = /lavfi\.r128\.M=(-?[0-9.]+|-inf)/.exec(line);
    if (m && t !== null) samples.push({ t, m: m[1] === "-inf" ? -120 : Number(m[1]) });
  }
  return samples;
}

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The loudest stretches, best first. Empty when the stream has no clear jumps or is mostly silence. */
export function findLoudMoments(samples: LoudSample[], liftDb = LOUD_LIFT_DB): LoudMoment[] {
  if (samples.length < 50) return [];
  // One reading per second: the average of that second's 100 ms readings.
  const seconds = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const sec = Math.floor(s.t);
    const cur = seconds.get(sec) ?? { sum: 0, n: 0 };
    cur.sum += Math.max(s.m, -80); cur.n++;
    seconds.set(sec, cur);
  }
  const perSecond = [...seconds.entries()].map(([sec, v]) => ({ sec, level: v.sum / v.n })).sort((a, b) => a.sec - b.sec);
  const baseline = median(perSecond.filter((p) => p.level > SILENCE_FLOOR).map((p) => p.level));
  if (!Number.isFinite(baseline)) return [];

  const loud = perSecond.filter((p) => p.level - baseline >= liftDb);
  const moments: LoudMoment[] = [];
  let current: { start: number; end: number; peakSec: number; peak: number } | null = null;
  for (const p of loud) {
    const lift = p.level - baseline;
    if (current && p.sec - current.end <= MERGE_GAP_SECONDS) {
      current.end = p.sec;
      if (lift > current.peak) { current.peak = lift; current.peakSec = p.sec; }
    } else {
      if (current) moments.push({ start_seconds: current.start, end_seconds: current.end + 1, peak_seconds: current.peakSec, lift_db: Math.round(current.peak * 10) / 10 });
      current = { start: p.sec, end: p.sec, peakSec: p.sec, peak: lift };
    }
  }
  if (current) moments.push({ start_seconds: current.start, end_seconds: current.end + 1, peak_seconds: current.peakSec, lift_db: Math.round(current.peak * 10) / 10 });
  return moments.sort((a, b) => b.lift_db - a.lift_db || (b.end_seconds - b.start_seconds) - (a.end_seconds - a.start_seconds)).slice(0, maxMomentsFor(samples[samples.length - 1].t)).sort((a, b) => a.start_seconds - b.start_seconds);
}

const stamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/** The prompt section for Gaming VODs. `quiet` tells the model to lean on these when there is little speech. */
export function formatLoudMomentsForPrompt(moments: LoudMoment[], quiet: boolean): string {
  if (!moments.length) return "";
  const lines = moments.map((m) => `- ${stamp(m.start_seconds)} to ${stamp(m.end_seconds)} (peak ${stamp(m.peak_seconds)}): ${m.lift_db} dB louder than the stream's usual volume`);
  return `

## LOUD GAME MOMENTS

These stretches of the audio jumped far above the stream's usual volume: explosions, big fights, screams, crowd noise. They are measured, not guessed. A streamer can play brilliantly while saying almost nothing, so do not skip a moment just because the transcript around it is empty.

${lines.join("\n")}

- Treat a loud moment as a strong sign that something happened on screen. The clip usually starts 5-15 seconds BEFORE the peak, so it includes the build-up.
- ${quiet ? "This streamer talks very little, so rely on these loud moments and on chat spikes as your main evidence, and judge them by the action rather than by the words." : "Combine these with what the streamer says: a loud play followed by a reaction is the best kind of clip."}
- A loud moment alone is not a verdict: music, a menu sound or a donation alert can be loud too. Prefer ones with speech or chat around them when you can, and still return a loud-only moment if nothing else in the VOD is stronger.`;
}

/** Words spoken per minute of video. A normal talking stream is well over 80. */
export function speechWordsPerMinute(wordCount: number, durationSeconds: number): number {
  return durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60 * 10) / 10 : 0;
}
/** Below this a stream is treated as quiet. The VOD that prompted this had about 15 and about 31. */
export const QUIET_WORDS_PER_MINUTE = 40;
export const isQuietStream = (wordCount: number, durationSeconds: number) =>
  durationSeconds >= 300 && speechWordsPerMinute(wordCount, durationSeconds) < QUIET_WORDS_PER_MINUTE;

/** Forward slashes, and the colon after a Windows drive letter escaped, as FFmpeg filters need. */
export function defaultFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
}

/**
 * Measure the audio file and return its loud moments. `ffmpeg` runs the loudness meter and writes the readings
 * to a file, which is read back; any failure returns no moments, so a measuring problem never fails an analysis.
 */
export async function detectLoudMoments(
  audioPath: string,
  deps: {
    run: (bin: string, args: string[], opts?: { maxRunMs?: number }) => Promise<unknown>;
    readText: (path: string) => Promise<string>;
    ffmpeg: string;
    outPath: string;
    /** Escapes a path for use inside an FFmpeg filter. The default handles Windows drive letters and backslashes. */
    filterPath?: (path: string) => string;
  },
): Promise<LoudMoment[]> {
  try {
    await deps.run(deps.ffmpeg, ["-hide_banner", "-nostats", "-loglevel", "error", "-i", audioPath, "-vn",
      "-af", `aresample=16000,ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file='${(deps.filterPath ?? defaultFilterPath)(deps.outPath)}'`,
      "-f", "null", "-"], { maxRunMs: 10 * 60_000 });
    return findLoudMoments(parseLoudnessMetadata(await deps.readText(deps.outPath)));
  } catch {
    return [];
  }
}
