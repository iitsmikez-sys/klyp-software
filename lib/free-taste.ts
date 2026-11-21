/**
 * The Free "taste": a free account analyzes the first hour of a video and gets its best clips unlocked; the rest are shown
 * (title and score) but locked until the person starts the Pro pass, which unlocks them with no extra Sparks because the
 * analysis is already paid for. Pure helpers, shared by the results page and the server checks.
 */
export const FREE_TOP_UNLOCKED = 3;

/** The message when a locked clip is asked for directly. */
export const CLIP_LOCKED_MESSAGE = "This clip is locked on the Free plan. Start the $3 Pro pass to unlock all of your clips. No extra Sparks.";

type Scored = { viral_score: number };

/**
 * Which clips of a result are open to this plan. Pro: all. Free: the best FREE_TOP_UNLOCKED by score (ties keep their order).
 * Returns the positions in the list that was passed in.
 */
export function unlockedIndexes(clips: Scored[], isPro: boolean): Set<number> {
  if (isPro) return new Set(clips.map((_, i) => i));
  return new Set(
    clips
      .map((clip, index) => ({ index, score: Number(clip.viral_score) || 0 }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, FREE_TOP_UNLOCKED)
      .map((entry) => entry.index),
  );
}
