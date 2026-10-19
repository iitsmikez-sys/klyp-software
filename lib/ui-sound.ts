"use client";

/**
 * Optional interface sounds — off unless the user turns them on in Settings.
 *
 * No UI sound ships with Klyp today: the only bundled audio is the landing
 * page's ambient music track, which is neither short nor a UI cue, and
 * downloading some arbitrary clip would be worse than silence. So this is the
 * wiring, ready for an asset: drop a short file at SOUND_SRC and enabling the
 * setting starts playing it. Until then a missing file fails silently rather
 * than throwing on every open.
 */

export const UI_SOUND_KEY = "klyp-ui-sounds";
/** Drop a short (<500ms), quiet cue here to activate the setting. */
const SOUND_SRC = "/audio/ui-open.mp3";
/** Low by default — this sits under clip audio, never over it. */
const VOLUME = 0.18;

/** Whether the user has opted in. Off unless explicitly enabled. */
export function uiSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(UI_SOUND_KEY) === "on";
  } catch {
    return false; // private mode / blocked storage — stay silent
  }
}

export function setUiSoundsEnabled(on: boolean): void {
  try {
    localStorage.setItem(UI_SOUND_KEY, on ? "on" : "off");
  } catch {
    /* preference simply won't persist */
  }
}

let element: HTMLAudioElement | null = null;
/** Set once a real input event has happened, so nothing can autoplay. */
let userHasInteracted = false;

if (typeof window !== "undefined") {
  const mark = () => { userHasInteracted = true; };
  window.addEventListener("pointerdown", mark, { once: true, capture: true });
  window.addEventListener("keydown", mark, { once: true, capture: true });
}

/**
 * Play the dialog-open cue, if the user enabled sounds and has interacted.
 * Safe to call on every open: it no-ops when disabled, when no asset exists,
 * or when the browser blocks playback.
 */
export function playOpenSound(): void {
  if (!userHasInteracted || !uiSoundsEnabled()) return;
  try {
    if (!element) {
      element = new Audio(SOUND_SRC);
      element.volume = VOLUME;
      element.preload = "auto";
    }
    // Restart rather than overlap when dialogs are opened in quick succession.
    element.currentTime = 0;
    void element.play().catch(() => { /* no asset, or blocked — stay silent */ });
  } catch {
    /* never let a cosmetic sound break opening a dialog */
  }
}
