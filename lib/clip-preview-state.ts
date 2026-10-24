/** The source preview contains the full original clip, so keep playback inside the draft trim. */
export function clipPreviewPlayback(currentTime: number, start: number, end: number): { time: number; pause: boolean } {
  if (currentTime >= end) return { time: start, pause: true };
  if (currentTime < start) return { time: start, pause: false };
  return { time: currentTime, pause: false };
}

/** Main actions use the last saved render; they must wait for local edits to be saved. */
export function clipPreviewActionBlocked(dirty: boolean): boolean {
  return dirty;
}
