"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";

type Props = {
  /** The length of the stream, shown like a YouTube thumbnail badge. */
  durationLabel?: string;
  /** Where the best moments sit on the stream, as a share of its length (0 to 1). */
  markers?: number[];
};

/**
 * The "before" side of the hero: a still frame from a long gaming stream, its length, and the moments Klyp found.
 * The green boxes mark where the AI is looking. Nothing here plays video or makes sound.
 */
export default function VodBeforeCard({ durationLabel = "1:40:41", markers = [0.086, 0.34, 0.71] }: Props) {
  const calm = useReducedMotion();
  return (
    <div className="w-full max-w-[560px]">
      <div className="relative aspect-[1146/720] overflow-hidden rounded-2xl border border-border bg-black shadow-accent-glow-sm">
        <Image src="/hero/vod-frame.jpg" alt="A frame from a long gaming stream" fill priority sizes="(max-width: 640px) 92vw, 560px" className="object-cover" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/25" />

        {/* The AI box on the player, with a soft pulse. */}
        <motion.div
          aria-hidden="true"
          className="absolute rounded-md border-2 border-accent"
          style={{ left: "26.5%", top: "43%", width: "18.5%", height: "39%" }}
          initial={calm ? false : { opacity: 0, scale: 1.12 }}
          animate={calm ? { opacity: 1 } : { opacity: 1, scale: 1, boxShadow: ["0 0 0 0 rgba(0,229,160,0.35)", "0 0 0 10px rgba(0,229,160,0)"] }}
          transition={calm ? undefined : { opacity: { delay: 0.5, duration: 0.4 }, scale: { delay: 0.5, duration: 0.4 }, boxShadow: { delay: 0.9, duration: 1.8, repeat: Infinity, ease: "easeOut" } }}
        >
          <span className="absolute -left-0.5 -top-0.5 rounded-br-md rounded-tl-sm bg-accent px-2 py-0.5 text-[10px] font-bold leading-none text-background">AI</span>
        </motion.div>

        {/* A second, fainter box on the fight. */}
        <motion.div
          aria-hidden="true"
          className="absolute rounded-md border border-dashed border-accent/60"
          style={{ left: "45%", top: "13%", width: "40%", height: "62%" }}
          initial={calm ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.5 }}
        />

        {/* A thin scan line that sweeps across, like Klyp reading the stream. */}
        {!calm && (
          <motion.div
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-accent/70 shadow-[0_0_14px_3px_rgba(0,229,160,0.45)]"
            initial={{ left: "0%", opacity: 0 }}
            animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 3.2, delay: 0.2, repeat: Infinity, repeatDelay: 2.6, ease: "easeInOut" }}
          />
        )}

        {/* How long the stream is, in the corner like a YouTube thumbnail. */}
        <span className="absolute bottom-14 right-3 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold tabular-nums text-white">{durationLabel}</span>

        {/* The stream's timeline with the best moments marked. */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-8">
          <div className="relative h-1.5 rounded-full bg-white/15">
            {markers.map((share, index) => (
              <motion.span
                key={index}
                aria-hidden="true"
                className="absolute top-1/2 h-3.5 w-1.5 -translate-y-1/2 rounded-sm bg-accent"
                style={{ left: `${Math.min(97, Math.max(1, share * 100))}%` }}
                initial={calm ? false : { opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ delay: 1.1 + index * 0.25, duration: 0.3 }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-white/70">
            <span>Full stream</span>
            <span className="font-medium text-accent">{markers.length} moments found</span>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-center">
        <span className="rounded-full border border-border bg-surface-2 px-4 py-1.5 text-sm text-foreground-muted">Before</span>
      </div>
    </div>
  );
}
