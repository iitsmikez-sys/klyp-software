import type { ChatSpike, AudioWindow } from './twitch-chat';

export type CandidateSource = 'chat' | 'audio' | 'scene' | 'quiet';
export type ActivityPoint = { seconds: number; strength: number };
export type CandidateWindow = AudioWindow & { sources: CandidateSource[] };
export type CandidatePlan = { windows: CandidateWindow[]; hourlyCoverage: boolean[]; coveredSeconds: number };

/** Signals propose footage for transcription and Opus review; they never return clips. */
export function planCandidateWindows(
  durationSeconds: number,
  chat: ChatSpike[],
  audio: ActivityPoint[],
  scenes: ActivityPoint[],
): CandidatePlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return { windows: [], hourlyCoverage: [], coveredSeconds: 0 };
  const duration = Math.ceil(durationSeconds);
  const hours = Math.ceil(duration / 3600);
  const proposed: CandidateWindow[] = [];
  const add = (seconds: number, source: CandidateSource) => {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds >= duration) return;
    const start = Math.max(0, Math.floor(seconds - 60));
    const end = Math.min(duration, Math.ceil(seconds + 60));
    if (end > start) proposed.push({ start, end, sources: [source] });
  };
  const strongestChat = [...chat].sort((a, b) => b.intensity - a.intensity);
  const hourlyChat = new Map<number, ChatSpike>();
  for (const point of strongestChat) {
    const hour = Math.floor(point.seconds / 3600);
    if (!hourlyChat.has(hour)) hourlyChat.set(hour, point);
  }
  [...new Set([...strongestChat.slice(0, 10), ...hourlyChat.values()])]
    .forEach(p => add(p.seconds - 8, 'chat'));
  [...audio].sort((a, b) => b.strength - a.strength).slice(0, 12).forEach(p => add(p.seconds, 'audio'));
  [...scenes].sort((a, b) => b.strength - a.strength).slice(0, 6).forEach(p => add(p.seconds, 'scene'));

  // Every hour gets a quiet-chat candidate even when all high-score events cluster elsewhere.
  for (let hour = 0; hour < hours; hour++) {
    const low = hour * 3600;
    const high = Math.min(duration, low + 3600);
    const quietAudio = [...audio]
      .filter(p => p.seconds >= low && p.seconds < high && chat.every(c => Math.abs(c.seconds - p.seconds) > 120))
      .sort((a, b) => b.strength - a.strength)[0];
    add(quietAudio?.seconds ?? Math.floor((low + high) / 2), 'quiet');
  }

  const windows: CandidateWindow[] = [];
  for (const current of proposed.sort((a, b) => a.start - b.start)) {
    const previous = windows.at(-1);
    if (previous && current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
      previous.sources = [...new Set([...previous.sources, ...current.sources])];
    } else windows.push({ ...current });
  }
  const hourlyCoverage = Array.from({ length: hours }, (_, hour) =>
    windows.some(w => w.start < Math.min(duration, (hour + 1) * 3600) && w.end > hour * 3600));
  return { windows, hourlyCoverage, coveredSeconds: windows.reduce((sum, w) => sum + w.end - w.start, 0) };
}

/** A clip is valid only if its whole setup-to-payoff interval was observed. */
export function clipInsideObservedCoverage(
  clip: { start_seconds: number; end_seconds: number },
  windows: AudioWindow[],
): boolean {
  if (!Number.isFinite(clip.start_seconds) || !Number.isFinite(clip.end_seconds) || clip.end_seconds <= clip.start_seconds) return false;
  const ordered = [...windows].sort((a, b) => a.start - b.start);
  let cursor = clip.start_seconds;
  for (const window of ordered) {
    if (window.end <= cursor) continue;
    if (window.start > cursor) return false;
    cursor = Math.max(cursor, window.end);
    if (cursor >= clip.end_seconds) return true;
  }
  return false;
}
