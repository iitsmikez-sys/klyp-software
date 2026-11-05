/**
 * The emotion curve: where in a video the feeling peaked. It lines up, second by second, what can be measured about a
 * moment: how much louder it is than the stream's nearby volume, a sudden jump, a burst after quiet, reaction words,
 * laughing, fast speech, chat spikes and a rise in the voice's pitch. Moments where several of these agree become
 * "emotion peaks", which are handed to Claude as measured evidence, never as a verdict. Pure maths, no imports.
 *
 * Klyp cannot see the video or measure feelings. This is an educated guess from sound, words and chat.
 */
export type LoudnessSample = { t: number; m: number };
export type TimedWordLike = { text: string; start: number; end: number };
export type ChatSpikeLike = { seconds: number; intensity: number };
export type EmotionContent = "gaming" | "irl";

export type EmotionPeak = {
  peak_seconds: number;
  start_seconds: number;
  end_seconds: number;
  /** 0 to 100: how many kinds of evidence agree, and how strongly. */
  strength: number;
  /** A hint about what viewers would feel: laughter, shock, anger, hype, or an intense moment. */
  feeling: string;
  evidence: string[];
};

export type SecondScore = {
  sec: number;
  /** How far above the nearby volume this second is, in decibels. */
  liftDb: number;
  jumpDb: number;
  quiet: number;
  reaction: number;
  anger: number;
  laugh: number;
  rate: number;
  chat: number;
  chatX: number;
  strongHits: number;
  laughHits: number;
};

const SILENCE_FLOOR = -60;
const BLOCK_SECONDS = 30;
const HALF_WINDOW = 150;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Words and phrases that show shock or excitement. Strong ones count fully; weak ones are common talk and count less. */
const STRONG_REACTIONS = ["no way", "oh my god", "omg", "what the", "holy", "bruh", "wtf", "let's go", "lets go", "ayo", "oh no", "oh shit", "are you kidding", "no no no", "oh my", "what is that", "what was that", "i can't", "i cant", "stop it", "get out"];
const WEAK_REACTIONS = ["bro", "dude", "yo", "wait", "nah", "crazy", "insane", "what"];
const ANGER_WORDS = ["fuck", "fucking", "shit", "damn", "bullshit", "stupid", "idiot", "hate", "cheating", "trash", "garbage", "sick of"];
const LAUGH = /^(ha){2,}h?$|^(he){2,}h?$|^(lol|lmao|lmfao|rofl|hahaha\w*)$/;
const LAUGH_WORDS = ["laughs", "laughing", "laughter", "giggles", "giggling", "cackling", "cackles"];

const WEIGHTS: Record<EmotionContent, Record<"loud" | "jump" | "quiet" | "words" | "rate" | "laugh" | "chat" | "pitch", number>> = {
  // Game audio is loud all the time, so the voice-based signs (words, laughing, pitch) count for more.
  gaming: { loud: 0.20, jump: 0.12, quiet: 0.10, words: 0.22, rate: 0.08, laugh: 0.14, chat: 0.16, pitch: 0.18 },
  irl: { loud: 0.26, jump: 0.12, quiet: 0.08, words: 0.20, rate: 0.08, laugh: 0.14, chat: 0.14, pitch: 0.16 },
};
/** The weighted sum that counts as 100. Several kinds of evidence together get there; one alone does not. */
const FULL_SCORE = 0.72;
/** A peak must reach this to be reported. */
export const MIN_PEAK_STRENGTH = 40;
const PEAK_GAP_SECONDS = 10;

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
const countPhrases = (text: string, phrases: string[]) => {
  let hits = 0;
  for (const phrase of phrases) {
    let at = text.indexOf(phrase);
    while (at !== -1) {
      const before = at === 0 || text[at - 1] === " ", after = at + phrase.length >= text.length || text[at + phrase.length] === " ";
      if (before && after) hits++;
      at = text.indexOf(phrase, at + phrase.length);
    }
  }
  return hits;
};

/**
 * One score per second of audio. Returns null when there is too little audio to judge (silence, or a very short video).
 * `chatSpikes` are Twitch chat bursts (chat reacts 3 to 18 seconds after what caused it).
 */
export function emotionCurve(input: { samples: LoudnessSample[]; words: TimedWordLike[]; chatSpikes?: ChatSpikeLike[] | null }): SecondScore[] | null {
  const { samples, words } = input;
  if (samples.length < 50) return null;

  // Loudness: one reading per second (the mean of its 100 ms readings).
  const acc = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const sec = Math.floor(s.t), cur = acc.get(sec) ?? { sum: 0, n: 0 };
    cur.sum += Math.max(s.m, -80); cur.n++;
    acc.set(sec, cur);
  }
  const levels = new Map<number, number>();
  let last = 0;
  for (const [sec, v] of acc) { levels.set(sec, v.sum / v.n); last = Math.max(last, sec); }
  const valid = [...levels.entries()].filter(([, level]) => level > SILENCE_FLOOR);
  if (valid.length < 20) return null;
  const globalBaseline = median(valid.map(([, level]) => level));

  // The stream's nearby volume, so a noisy street or a loud game does not make everything look loud.
  const blocks: number[] = [];
  for (let b = 0; b * BLOCK_SECONDS <= last; b++) {
    const center = b * BLOCK_SECONDS + BLOCK_SECONDS / 2;
    const near = valid.filter(([sec]) => sec >= center - HALF_WINDOW && sec <= center + HALF_WINDOW).map(([, level]) => level);
    blocks.push(near.length >= 10 ? median(near) : globalBaseline);
  }
  const baselineAt = (sec: number) => blocks[Math.floor(sec / BLOCK_SECONDS)] ?? globalBaseline;

  // Words by second.
  const bySecond = new Map<number, string[]>();
  for (const w of words) {
    const token = normalize(w.text);
    if (!token) continue;
    const sec = Math.floor(w.start / 1000);
    (bySecond.get(sec) ?? bySecond.set(sec, []).get(sec)!).push(token);
  }
  const wordsPerSecond = (from: number, to: number) => { let n = 0; for (let s = from; s <= to; s++) n += bySecond.get(s)?.length ?? 0; return n / (to - from + 1); };
  const speechSeconds = [...bySecond.keys()];
  const typicalRate = speechSeconds.length > 20 ? median(speechSeconds.map((s) => wordsPerSecond(s - 2, s + 2))) : NaN;

  const spikes = [...(input.chatSpikes ?? [])].sort((a, b) => a.seconds - b.seconds);

  const out: SecondScore[] = [];
  for (let sec = 0; sec <= last; sec++) {
    const level = levels.get(sec);
    if (level === undefined || level <= SILENCE_FLOOR) { out.push({ sec, liftDb: 0, jumpDb: 0, quiet: 0, reaction: 0, anger: 0, laugh: 0, rate: 0, chat: 0, chatX: 0, strongHits: 0, laughHits: 0 }); continue; }
    const baseline = baselineAt(sec);
    const liftDb = level - baseline;
    const before = [] as number[];
    for (let s = sec - 6; s <= sec - 2; s++) { const v = levels.get(s); if (v !== undefined && v > SILENCE_FLOOR) before.push(v); }
    const jumpDb = before.length >= 3 ? level - median(before) : 0;
    const prior = [] as number[];
    for (let s = sec - 3; s <= sec - 1; s++) { const v = levels.get(s); if (v !== undefined) prior.push(v); }
    const quiet = prior.length >= 2 && prior.every((v) => v < baseline - 3) && liftDb >= 6 ? 1 : 0;

    const tokens: string[] = [];
    for (let s = sec - 1; s <= sec + 2; s++) tokens.push(...(bySecond.get(s) ?? []));
    const text = tokens.join(" ");
    const strongHits = countPhrases(text, STRONG_REACTIONS), weakHits = countPhrases(text, WEAK_REACTIONS);
    const angerHits = countPhrases(text, ANGER_WORDS);
    const laughHits = tokens.filter((t) => LAUGH.test(t)).length + countPhrases(text, LAUGH_WORDS);

    const rate = Number.isFinite(typicalRate) && typicalRate > 0 ? clamp01((wordsPerSecond(sec - 2, sec + 2) / typicalRate - 1.8) / 1.4) : 0;
    let chatX = 0;
    for (const spike of spikes) { if (spike.seconds > sec + 18) break; if (spike.seconds >= sec + 3) chatX = Math.max(chatX, spike.intensity); }

    out.push({
      sec, liftDb: Math.round(liftDb * 10) / 10, jumpDb: Math.round(jumpDb * 10) / 10, quiet,
      reaction: clamp01((strongHits + 0.35 * weakHits) / 2.5), anger: clamp01(angerHits / 2), laugh: clamp01(laughHits / 2), rate,
      chat: clamp01((chatX - 2) / 5), chatX, strongHits, laughHits,
    });
  }
  return out;
}

/** The score of one second, 0 to 1 (before it is scaled to 100). `pitch` is a 0..1 score from the voice rising. */
function scoreOf(s: SecondScore, content: EmotionContent, pitch: number): number {
  const w = WEIGHTS[content];
  const sum =
    w.loud * clamp01((s.liftDb - 4) / 14) + w.jump * clamp01((s.jumpDb - 5) / 12) + w.quiet * s.quiet +
    w.words * Math.max(s.reaction, s.anger * 0.9) + w.rate * s.rate + w.laugh * s.laugh + w.chat * s.chat + w.pitch * pitch;
  return Math.min(1, sum / FULL_SCORE);
}

/** A voice that is 15% higher than a few seconds earlier starts to count; 65% higher counts fully. */
const pitchScore = (ratio: number | undefined) => (ratio === undefined ? 0 : clamp01((ratio - 1.15) / 0.5));

/** The moments worth measuring the voice pitch for: the strongest seconds so far, spread out. */
export function pickPitchCandidates(curve: SecondScore[], content: EmotionContent, count = 24): number[] {
  const ranked = curve.map((s) => ({ sec: s.sec, score: scoreOf(s, content, 0) })).filter((s) => s.score >= 0.25).sort((a, b) => b.score - a.score);
  const picked: number[] = [];
  for (const r of ranked) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p - r.sec) >= PEAK_GAP_SECONDS)) picked.push(r.sec);
  }
  return picked.sort((a, b) => a - b);
}

function feelingOf(s: SecondScore, pitch: number): string {
  if (s.laugh >= 0.5) return "laughter";
  if (s.anger >= 0.5) return "anger";
  if (s.strongHits >= 1 && (s.jumpDb >= 6 || s.liftDb >= 8)) return "shock";
  if (s.chat >= 0.4 && s.liftDb >= 6) return "hype";
  if (pitch >= 0.4 && s.liftDb >= 4) return "excitement";
  if (s.liftDb >= 8 || s.jumpDb >= 8) return "an intense moment";
  return "a reaction";
}

function evidenceOf(s: SecondScore, ratio: number | undefined): string[] {
  const out: string[] = [];
  if (s.liftDb >= 6) out.push(`volume ${Math.round(s.liftDb)} dB above the nearby level`);
  if (s.jumpDb >= 8) out.push(`a sudden ${Math.round(s.jumpDb)} dB jump`);
  if (s.quiet) out.push("a burst right after quiet");
  if (s.strongHits >= 1) out.push(`${s.strongHits} reaction ${s.strongHits === 1 ? "phrase" : "phrases"} in speech`);
  if (s.anger >= 0.5) out.push("angry words in speech");
  if (s.laughHits >= 1) out.push(s.laughHits === 1 ? "laughing in speech" : `${s.laughHits} laughs in speech`);
  if (s.rate >= 0.4) out.push("much faster speech than usual");
  if (s.chatX >= 3) out.push(`a chat spike (${Math.round(s.chatX * 10) / 10}x) a few seconds later`);
  if (ratio !== undefined && ratio >= 1.25) out.push(`voice pitch ${Math.round((ratio - 1) * 100)}% higher than just before`);
  return out;
}

/**
 * The emotion peaks, strongest first, spread at least 10 seconds apart. `pitchRatios` maps a second to how much the
 * voice rose there (from measurePitchRatios); it can be empty.
 */
export function findEmotionPeaks(curve: SecondScore[], content: EmotionContent, durationSeconds: number, pitchRatios: Map<number, number> = new Map()): EmotionPeak[] {
  if (!curve.length) return [];
  const ratioNear = (sec: number) => { for (let d = 0; d <= 2; d++) { const r = pitchRatios.get(sec + d) ?? pitchRatios.get(sec - d); if (r !== undefined) return r; } return undefined; };
  const scored = curve.map((s) => { const ratio = ratioNear(s.sec); const p = pitchScore(ratio); return { s, ratio, p, score: scoreOf(s, content, p) }; });
  // Smooth over 5 seconds so one noisy second is not a peak by itself.
  const smooth = scored.map((x, i) => Math.max(...scored.slice(Math.max(0, i - 2), i + 3).map((y) => y.score)));
  const ranked = scored.map((x, i) => ({ x, strength: Math.round(smooth[i] * 100) })).filter((r) => r.strength >= MIN_PEAK_STRENGTH)
    .sort((a, b) => b.strength - a.strength || a.x.s.sec - b.x.s.sec);
  const limit = Math.min(20, Math.max(6, Math.ceil(durationSeconds / 300)));
  const peaks: EmotionPeak[] = [];
  for (const r of ranked) {
    if (peaks.length >= limit) break;
    // Report the strongest second inside the smoothing window, not the one next to it.
    const window = scored.filter((y) => Math.abs(y.s.sec - r.x.s.sec) <= 2);
    const best = window.reduce((a, b) => (b.score > a.score ? b : a), r.x);
    const sec = best.s.sec;
    if (peaks.some((p) => Math.abs(p.peak_seconds - sec) < PEAK_GAP_SECONDS)) continue;
    peaks.push({
      peak_seconds: sec, start_seconds: Math.max(0, sec - 10), end_seconds: Math.min(Math.max(1, Math.floor(durationSeconds)), sec + 4),
      strength: r.strength, feeling: feelingOf(best.s, best.p), evidence: evidenceOf(best.s, best.ratio),
    });
  }
  return peaks.sort((a, b) => b.strength - a.strength);
}

const stamp = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/** The prompt section handed to Claude. Empty when there are no peaks. */
export function formatEmotionPeaksForPrompt(peaks: EmotionPeak[], content: EmotionContent): string {
  if (!peaks.length) return "";
  const lines = peaks.map((p) => `- ${stamp(p.peak_seconds)} (about ${stamp(p.start_seconds)} to ${stamp(p.end_seconds)}): strength ${p.strength}/100, likely ${p.feeling}. Evidence: ${p.evidence.length ? p.evidence.join("; ") : "several small signs together"}.`);
  return `

## EMOTION PEAKS

These are the moments where the feeling most likely peaked, measured from the audio's volume and its sudden jumps, the words spoken, laughing, the speed of speech, the rise of the voice and chat spikes. They are measured evidence, not guesses, but they are not a verdict either.

${lines.join("\n")}

- ${content === "gaming" ? "Game audio is loud by itself, so trust a peak more when the streamer's own voice shows it (reaction words, laughing, a rise in pitch) and less when it is only volume." : "Streets, crowds and music are loud too, so trust a peak more when someone is speaking or laughing right there, and less when it is only volume."}
- A viewer who has never seen this stream should feel something within the first few seconds. Prefer peaks where two or more kinds of evidence agree.
- The clip usually starts 5-15 seconds BEFORE the peak, so it includes the setup. Anchor on what caused the feeling, not on the peak itself.
- Use "likely" feeling only as a hint for the clip type and the emotional intensity score. Decide the real type from what happened in the transcript.
- If the transcript does not support a self-contained clip around a peak, ignore that peak. Never return a clip only because a number was high.`;
}
