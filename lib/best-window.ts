/**
 * "Smart pick": which stretch of a long video to analyze when only part of it can be. Pure, so it can be tested on its own.
 *
 * The audio is read for loudness (see lib/loud-moments.ts). A second counts as lively when it is well above the stream's usual
 * volume, the same bar the loud-moment hints use. Each window's score is how many lively seconds it holds, with each second's
 * lift capped so one huge noise cannot win on its own. The best window wins; ties go to the earliest; if nothing stands out the
 * answer is 0, the plain start of the video.
 */
import { LOUD_LIFT_DB, type LoudSample } from "./loud-moments.ts";

const STEP_SECONDS = 60;
const LIFT_CAP_DB = 24;
const SILENCE_FLOOR = -60;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Where (in whole seconds, a multiple of a minute) the best `windowSeconds` of a `totalSeconds` video starts. */
export function bestWindowStart(samples: readonly LoudSample[], totalSeconds: number, windowSeconds: number): number {
  const lastStart = Math.floor((totalSeconds - windowSeconds) / STEP_SECONDS) * STEP_SECONDS;
  if (!Number.isFinite(totalSeconds) || !Number.isFinite(windowSeconds) || windowSeconds <= 0 || lastStart <= 0 || samples.length < 50) return 0;

  // One reading per second: the average of that second's readings.
  const perSecond = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const sec = Math.floor(s.t);
    if (sec < 0 || sec >= totalSeconds) continue;
    const cur = perSecond.get(sec) ?? { sum: 0, n: 0 };
    cur.sum += Math.max(s.m, -80); cur.n++;
    perSecond.set(sec, cur);
  }
  const levels = [...perSecond.entries()].map(([sec, v]) => ({ sec, level: v.sum / v.n }));
  const baseline = median(levels.filter((l) => l.level > SILENCE_FLOOR).map((l) => l.level));
  if (!Number.isFinite(baseline)) return 0;

  const total = Math.ceil(totalSeconds);
  const lift = new Float64Array(total + 1); // prefix sums: lift[i] = score of seconds before i
  const score = new Float64Array(total);
  for (const { sec, level } of levels) {
    const over = level - baseline;
    if (over >= LOUD_LIFT_DB && sec < total) score[sec] = Math.min(over, LIFT_CAP_DB);
  }
  for (let i = 0; i < total; i++) lift[i + 1] = lift[i] + score[i];

  let best = 0, bestScore = -1;
  for (let start = 0; start <= lastStart; start += STEP_SECONDS) {
    const end = Math.min(total, start + windowSeconds);
    const windowScore = lift[end] - lift[start];
    if (windowScore > bestScore + 1e-9) { best = start; bestScore = windowScore; }
  }
  return bestScore > 0 ? best : 0;
}
