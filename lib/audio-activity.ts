import type { ActivityPoint } from './vod-candidates';

export type EnergyFrame = { seconds: number; rms: number };

/** Low-cost audio changes nominate windows; only Opus may judge a clip. */
export function activityFromEnergyFrames(frames: EnergyFrame[]): ActivityPoint[] {
  const candidates: ActivityPoint[] = [];
  for (let i = 1; i < frames.length; i++) {
    const current = frames[i];
    if (!Number.isFinite(current.rms) || current.rms < 900) continue;
    const before = frames.slice(Math.max(0, i - 10), i);
    const baseline = before.reduce((sum, item) => sum + item.rms, 0) / before.length;
    if (baseline < 0 || current.rms < Math.max(1800, baseline * 2.5)) continue;
    const strength = Math.log2(current.rms / Math.max(250, baseline));
    if (strength >= 1.3) candidates.push({ seconds: current.seconds, strength });
  }
  const kept: ActivityPoint[] = [];
  for (const point of candidates.sort((a, b) => b.strength - a.strength)) {
    if (kept.every(existing => Math.abs(existing.seconds - point.seconds) >= 30)) kept.push(point);
  }
  return kept.sort((a, b) => a.seconds - b.seconds);
}
