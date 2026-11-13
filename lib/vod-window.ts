/**
 * Choosing a part of a video that is longer than the plan allows (Pro: up to 8 hours at once).
 * Pure helpers, shared by the picker bar and the server, so the same rules hold on both sides.
 */

/** Windows move in 5 minute steps. */
export const WINDOW_STEP_SECONDS = 300;
/** The shortest part worth running. */
export const MIN_WINDOW_SECONDS = 600;

export type WindowShortcut = "first" | "middle" | "last";
export type Range = { start: number; end: number };

const snap = (seconds: number) => Math.round(seconds / WINDOW_STEP_SECONDS) * WINDOW_STEP_SECONDS;

/** The window a shortcut means for a video of `totalSeconds` and a plan cap of `capSeconds`. */
export function windowShortcut(kind: WindowShortcut, totalSeconds: number, capSeconds: number): Range {
  const length = Math.min(totalSeconds, capSeconds);
  if (kind === "first") return { start: 0, end: length };
  if (kind === "last") return { start: Math.max(0, snap(totalSeconds - length)), end: Math.max(0, snap(totalSeconds - length)) + length };
  const start = Math.max(0, Math.min(snap((totalSeconds - length) / 2), totalSeconds - length));
  return { start, end: start + length };
}

/**
 * Where a handle drag lands. The window never gets longer than the cap (the dragged handle stops and `hitCap` says so),
 * never shorter than the minimum, and never leaves the video.
 */
export function snapWindow(input: {
  kind: "start" | "end" | "move";
  seconds: number;
  grab: number;
  start: number;
  end: number;
  totalSeconds: number;
  capSeconds: number;
}): Range & { hitCap: boolean } {
  const { kind, seconds, grab, totalSeconds, capSeconds } = input;
  let { start, end } = input;
  let hitCap = false;
  if (kind === "start") {
    let next = Math.max(0, Math.min(snap(seconds), end - MIN_WINDOW_SECONDS));
    if (end - next > capSeconds) { next = end - capSeconds; hitCap = true; }
    start = next;
  } else if (kind === "end") {
    let next = Math.min(totalSeconds, Math.max(snap(seconds), start + MIN_WINDOW_SECONDS));
    if (next - start > capSeconds) { next = start + capSeconds; hitCap = true; }
    end = next;
  } else {
    const length = end - start;
    const next = Math.max(0, Math.min(totalSeconds - length, snap(seconds - grab)));
    start = next;
    end = next + length;
  }
  return { start, end, hitCap };
}

/** "8:30" or "1:08:30" style clock for a handle label (hours:minutes of the video). */
export function fmtWindowClock(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "8h 05m" for lengths. */
export function fmtWindowLength(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Whole-hour tick marks for a video, leaving room for the end label. */
export function tickHours(totalSeconds: number): number[] {
  const hours = totalSeconds / 3600;
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : 4;
  const out: number[] = [];
  for (let h = 0; h <= hours + 1e-9; h += step) if ((h * 3600) / totalSeconds <= 0.9) out.push(h);
  return out;
}

/**
 * What the server does with a window the browser asked for. Only a video that is over the plan's cap gets one;
 * the length is capped, the start is kept inside the video. Anything unusable means "no window".
 */
export function resolveRequestedWindow(input: {
  requestedStart: unknown;
  requestedSeconds: unknown;
  verifiedSeconds: number;
  capSeconds: number;
}): { start: number; seconds: number } | null {
  const start = Number(input.requestedStart);
  const seconds = Number(input.requestedSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(seconds) || start < 0 || seconds < MIN_WINDOW_SECONDS) return null;
  if (input.verifiedSeconds <= input.capSeconds) return null;
  const length = Math.min(Math.round(seconds), input.capSeconds, Math.round(input.verifiedSeconds));
  const from = Math.max(0, Math.min(Math.round(start), Math.round(input.verifiedSeconds) - length));
  return { start: from, seconds: length };
}
