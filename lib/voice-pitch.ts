/**
 * Voice pitch, a free extra sign of a real reaction: when someone is shocked, excited or angry their voice jumps
 * higher than it was a few seconds earlier. Pure maths on raw audio samples (no imports), plus a small helper
 * that measures a few short windows of an audio file with FFmpeg. A failure anywhere only means no pitch evidence.
 */
export const PITCH_SAMPLE_RATE = 8000;
const MIN_HZ = 70, MAX_HZ = 400;
/** Frames quieter than this (0..1 of full scale) are treated as silence, not a voice. */
const MIN_RMS = 0.01;
const FRAME = 512, HOP = 256;
/** How clearly periodic a frame must be to count as a voice (0..1). */
const MIN_CLARITY = 0.5;

/** The pitch of one frame in Hz by autocorrelation, or null when the frame is silent or not clearly a voice. */
export function estimatePitchHz(frame: ArrayLike<number>, sampleRate = PITCH_SAMPLE_RATE): number | null {
  const n = frame.length;
  if (n < 128) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;
  let energy = 0;
  for (let i = 0; i < n; i++) { const v = frame[i] - mean; energy += v * v; }
  if (Math.sqrt(energy / n) < MIN_RMS) return null;
  const minLag = Math.floor(sampleRate / MAX_HZ), maxLag = Math.min(n - 1, Math.ceil(sampleRate / MIN_HZ));
  let bestLag = -1, best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < n; i++) sum += (frame[i] - mean) * (frame[i + lag] - mean);
    const r = sum / energy;
    if (r > best) { best = r; bestLag = lag; }
  }
  if (bestLag < 0 || best < MIN_CLARITY) return null;
  return sampleRate / bestLag;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The typical pitch of a stretch of audio (samples scaled -1..1), or null when too little of it is a clear voice. */
export function medianPitchHz(samples: ArrayLike<number>, sampleRate = PITCH_SAMPLE_RATE, minVoicedFrames = 8): number | null {
  const pitches: number[] = [];
  const buffer = new Float32Array(FRAME);
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    for (let i = 0; i < FRAME; i++) buffer[i] = samples[start + i];
    const hz = estimatePitchHz(buffer, sampleRate);
    if (hz !== null) pitches.push(hz);
  }
  return pitches.length >= minVoicedFrames ? median(pitches) : null;
}

/** How much higher the voice is "during" than "before", as a ratio (1 = the same), or null when either is unclear. */
export function pitchRatio(before: ArrayLike<number>, during: ArrayLike<number>, sampleRate = PITCH_SAMPLE_RATE): number | null {
  const a = medianPitchHz(before, sampleRate), b = medianPitchHz(during, sampleRate);
  if (a === null || b === null) return null;
  const ratio = b / a;
  // A voice does not really jump by more than about double: that is the measurement landing on a harmonic, so ignore it.
  if (ratio > 2.2 || ratio < 0.45) return null;
  return Math.round(ratio * 100) / 100;
}

/** 16-bit PCM bytes to samples scaled -1..1. */
export function pcmToFloat(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
  const out = new Float32Array(view.byteLength / 2);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** Seconds before and after each moment that are compared: the calm "before" and the reaction itself. */
const BEFORE = { from: 9, to: 4 };
const DURING = { from: 2, to: 3 };

export type PitchDeps = {
  run: (bin: string, args: string[], opts?: { maxRunMs?: number }) => Promise<unknown>;
  readBytes: (path: string) => Promise<Uint8Array>;
  ffmpeg: string;
  /** A scratch file path for one window (unique per call). */
  tempPath: (index: number) => string;
};

/**
 * For each moment (second), how much the voice rose from a few calm seconds before to the reaction. One short
 * FFmpeg read per moment. Moments where the voice is unclear are left out. Any failure returns what was measured.
 */
export async function measurePitchRatios(audioPath: string, moments: number[], deps: PitchDeps, concurrency = 4): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const jobs = moments.map((second, index) => ({ second, index }));
  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      try {
        const start = Math.max(0, job.second - BEFORE.from);
        const file = deps.tempPath(job.index);
        await deps.run(deps.ffmpeg, ["-hide_banner", "-nostats", "-loglevel", "error", "-y", "-ss", String(start), "-t", String(BEFORE.from + DURING.to),
          "-i", audioPath, "-vn", "-ac", "1", "-ar", String(PITCH_SAMPLE_RATE), "-f", "s16le", file], { maxRunMs: 60_000 });
        const pcm = pcmToFloat(await deps.readBytes(file));
        const at = (seconds: number) => Math.max(0, Math.round((seconds - start) * PITCH_SAMPLE_RATE));
        const before = pcm.subarray(at(job.second - BEFORE.from), at(job.second - BEFORE.to));
        const during = pcm.subarray(at(job.second - DURING.from), at(job.second + DURING.to));
        const ratio = pitchRatio(before, during);
        if (ratio !== null) out.set(job.second, ratio);
      } catch { /* this moment has no pitch evidence */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}
