"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "klyp-ambient-on";
const TRACK_SRC = "/audio/ambient.mp3";
const TARGET_VOLUME = 0.22;

export default function AmbientAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const getAudio = () => {
    if (!audioRef.current) {
      const a = new Audio(TRACK_SRC);
      a.loop = true;
      a.volume = 0;
      a.preload = "none";
      audioRef.current = a;
    }
    return audioRef.current;
  };

  const fadeTo = (audio: HTMLAudioElement, target: number, then?: () => void) => {
    if (fadeRef.current) clearInterval(fadeRef.current);
    fadeRef.current = setInterval(() => {
      const diff = target - audio.volume;
      if (Math.abs(diff) < 0.015) {
        audio.volume = target;
        if (fadeRef.current) clearInterval(fadeRef.current);
        then?.();
      } else {
        audio.volume += diff * 0.15;
      }
    }, 50);
  };

  const start = async () => {
    const audio = getAudio();
    try {
      await audio.play();
      fadeTo(audio, TARGET_VOLUME);
      setPlaying(true);
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Missing file or browser blocked playback
      setUnavailable(true);
      setPlaying(false);
    }
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio) fadeTo(audio, 0, () => audio.pause());
    setPlaying(false);
    sessionStorage.setItem(STORAGE_KEY, "0");
  };

  // Resume only if the user already opted in earlier this session.
  // If the browser blocks it (no fresh gesture), we stay silent.
  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === "1") {
      const audio = getAudio();
      audio
        .play()
        .then(() => {
          fadeTo(audio, TARGET_VOLUME);
          setPlaying(true);
        })
        .catch(() => setPlaying(false));
    }
    return () => {
      if (fadeRef.current) clearInterval(fadeRef.current);
      audioRef.current?.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (unavailable) return null;

  return (
    <button
      onClick={playing ? stop : start}
      aria-label={playing ? "Mute ambient music" : "Play ambient music"}
      title={playing ? "Mute ambient music" : "Play ambient music"}
      className={`fixed bottom-5 right-5 z-50 flex items-center justify-center w-10 h-10 rounded-full border backdrop-blur-md transition-all duration-300 ${
        playing
          ? "bg-accent-glow border-accent/40 text-accent shadow-accent-glow-sm"
          : "bg-surface/80 border-border text-foreground-muted hover:text-foreground hover:border-subtle"
      }`}
    >
      {playing ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      )}
    </button>
  );
}
