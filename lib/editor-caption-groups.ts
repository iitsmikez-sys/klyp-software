import type { CaptionCue } from './editor-timeline.ts';

export type CaptionGroup = {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  cues: CaptionCue[];
};

/** A display-only view of caption cues. Draft timing and export remain word-precise. */
export function groupCaptionCues(cues: CaptionCue[], zoom: number): CaptionGroup[] {
  if (!cues.length) return [];
  const fine = zoom >= 2.5;
  const minMs = fine ? 900 : 2600;
  const maxMs = fine ? 2200 : 5000;
  const maxCues = fine ? 6 : 16;
  const sorted = [...cues].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  const groups: CaptionGroup[] = [];
  let current: CaptionCue[] = [];
  const flush = () => {
    if (!current.length) return;
    groups.push({
      id: current[0].id,
      start_ms: current[0].start_ms,
      end_ms: Math.max(...current.map(cue => cue.end_ms)),
      text: current.map(cue => cue.text).join(' '),
      cues: current,
    });
    current = [];
  };
  for (const cue of sorted) {
    const first = current[0];
    const last = current.at(-1);
    if (first && last) {
      const elapsed = last.end_ms - first.start_ms;
      const gap = cue.start_ms - last.end_ms;
      if (gap > 800 || (elapsed >= minMs &&
          (/[.!?]["'”’]?$/u.test(last.text.trim()) || cue.end_ms - first.start_ms > maxMs || current.length >= maxCues))) flush();
    }
    current.push(cue);
  }
  flush();
  return groups;
}
