"use client";

/**
 * The paste box's animated hint: "Paste a link from" followed by a platform name that changes every 4 seconds
 * (YouTube, Twitch, Kick), each in its own colour. It sits over the empty box, ignores clicks, and is hidden from
 * screen readers: the box describes itself in plain words instead (see AnalyzePanel).
 */
import { useEffect, useState } from "react";
import styles from "./PasteBoxHint.module.css";
import { YOUTUBE_ENABLED } from "@/lib/youtube-switch";

export const PASTE_HINT_HOLD_MS = 4000;
const ALL_PASTE_HINT_PLATFORMS = [
  { name: "YouTube", className: "text-[#ff4e45]" },
  { name: "Twitch", className: "text-[#a970ff]" },
  { name: "Kick", className: "text-[#53fc18]" },
] as const;
export const PASTE_HINT_PLATFORMS = ALL_PASTE_HINT_PLATFORMS.filter((platform) => YOUTUBE_ENABLED || platform.name !== "YouTube");

export default function PasteBoxHint() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((n) => (n + 1) % PASTE_HINT_PLATFORMS.length), PASTE_HINT_HOLD_MS);
    return () => clearInterval(id);
  }, []);
  const platform = PASTE_HINT_PLATFORMS[index];
  return (
    <span
      aria-hidden="true"
      data-paste-hint
      className="pointer-events-none absolute inset-y-0 left-4 right-4 flex items-center gap-1 overflow-hidden whitespace-nowrap text-[15px] text-foreground-muted"
    >
      <span>Paste a link from</span>
      <span key={platform.name} className={`${styles.word} ${platform.className}`}>{platform.name}</span>
    </span>
  );
}
