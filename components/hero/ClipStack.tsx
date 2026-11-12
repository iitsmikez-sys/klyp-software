"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, type PanInfo } from "framer-motion";

export type HeroClip = {
  /** A short looping video with no sound. */
  src: string;
  /** The first frame, shown right away and while a clip waits its turn. */
  poster: string;
  /** The clip type, like RAGE or FUNNY. */
  label: string;
  /** Only set a score if Klyp really gave this clip that score. The landing page shows none. */
  score?: number;
};

type Props = {
  clips: HeroClip[];
  /** How long each clip stays in front before the next one moves up, in milliseconds. 0 turns it off. */
  autoAdvanceMs?: number;
};

const SPREAD_PX = 84;
/** The two clips behind the front one are blurred; they sharpen as they move to the front. */
const SIDE_BLUR_PX = 6;

/**
 * A fanned stack of vertical clips. Every clip plays on a loop with no sound; swipe the front one (or click a side
 * clip, or use the dots) to bring the next one forward. It moves on its own every few seconds and pauses on hover.
 */
export default function ClipStack({ clips, autoAdvanceMs = 6500 }: Props) {
  const calm = useReducedMotion();
  const count = clips.length;
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);

  const go = (step: number) => setActive((value) => (value + step + count) % count);

  // All three clips loop at once (they are tiny and silent). People who turn motion off see the still first frames.
  useEffect(() => {
    const play = () => videos.current.forEach((video) => { if (video && video.paused) video.play().catch(() => {}); });
    if (calm) {
      videos.current.forEach((video) => video?.pause());
      return;
    }
    play();
    const resume = () => { if (document.visibilityState === "visible") play(); };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [calm]);

  useEffect(() => {
    if (calm || hovering || count < 2 || !autoAdvanceMs) return;
    const timer = setInterval(() => go(1), autoAdvanceMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm, hovering, count, autoAdvanceMs, active]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -45 || info.velocity.x < -400) go(1);
    else if (info.offset.x > 45 || info.velocity.x > 400) go(-1);
  };

  return (
    <div className="flex flex-col items-center" onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}>
      <div className="relative h-[340px] w-[310px]" role="group" aria-label="Example clips made by Klyp">
        {clips.map((clip, index) => {
          const position = (index - active + count) % count; // 0 is the front, 1 sits on the right, the last on the left
          const front = position === 0;
          const side = position === 1 ? 1 : -1;
          return (
            <motion.div
              key={clip.src}
              className={`absolute left-1/2 top-0 -ml-[85px] h-[302px] w-[170px] overflow-hidden rounded-2xl border bg-surface ${front ? "cursor-grab border-accent shadow-accent-glow active:cursor-grabbing" : "cursor-pointer border-border"}`}
              style={{ zIndex: front ? 3 : 1, touchAction: "pan-y" }}
              animate={front ? { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1, filter: "blur(0px)" } : { x: side * SPREAD_PX, y: 22, rotate: side * 8, scale: 0.86, opacity: 0.85, filter: `blur(${SIDE_BLUR_PX}px)` }}
              transition={calm ? { duration: 0 } : { type: "spring", stiffness: 230, damping: 26 }}
              drag={front ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.4}
              onDragEnd={front ? onDragEnd : undefined}
              onClick={front ? undefined : () => setActive(index)}
              aria-label={front ? undefined : `Show ${clip.label.toLowerCase()} clip`}
            >
              <video
                ref={(node) => { videos.current[index] = node; }}
                src={clip.src}
                poster={clip.poster}
                muted
                loop
                playsInline
                autoPlay={!calm}
                preload="auto"
                onCanPlay={(event) => { if (!calm) event.currentTarget.play().catch(() => {}); }}
                aria-hidden="true"
                tabIndex={-1}
                draggable={false}
                className="pointer-events-none h-full w-full object-cover"
              />
              <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent">
                {clip.score === undefined ? clip.label : `${clip.label} ${clip.score}`}
              </span>
            </motion.div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-2">
        {clips.map((clip, index) => (
          <button
            key={clip.src}
            type="button"
            aria-label={`Show clip ${index + 1} of ${count}`}
            aria-current={index === active}
            onClick={() => setActive(index)}
            className={`h-1.5 rounded-full transition-all ${index === active ? "w-5 bg-accent" : "w-1.5 bg-white/25 hover:bg-white/40"}`}
          />
        ))}
      </div>
      <div className="mt-3 flex justify-center">
        <span className="rounded-full border border-accent/40 bg-accent-glow px-4 py-1.5 text-sm text-accent">After</span>
      </div>
    </div>
  );
}
