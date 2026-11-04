"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

type Props = {
  /** How many dots. */
  count?: number;
  /** How long the glow stays on one dot before it moves to the next, in milliseconds. */
  stepMs?: number;
};

/**
 * A row of small dots with one slow glow that travels along them and back again, like a loading indicator.
 * It sits between the stream on the left and the clips on the right. Purely decorative.
 */
export default function LoadingDots({ count = 6, stepMs = 520 }: Props) {
  const calm = useReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (calm) return;
    const timer = setInterval(() => setTick((value) => value + 1), stepMs);
    return () => clearInterval(timer);
  }, [calm, stepMs]);

  // The glow goes 0, 1, 2 ... last, then back down again.
  const cycle = Math.max(1, (count - 1) * 2);
  const phase = tick % cycle;
  const active = phase < count ? phase : cycle - phase;

  return (
    <div aria-hidden="true" className="flex items-center gap-2.5 px-1">
      {Array.from({ length: count }, (_, index) => {
        const distance = Math.abs(index - active);
        const strength = distance === 0 ? 1 : distance === 1 ? 0.4 : 0;
        return (
          <span
            key={index}
            className="block h-2 w-2 rounded-full"
            style={{
              backgroundColor: strength ? `rgba(0, 229, 160, ${0.25 + 0.75 * strength})` : "rgba(255, 255, 255, 0.16)",
              transform: `scale(${1 + 0.4 * strength})`,
              boxShadow: distance === 0 ? "0 0 12px 3px rgba(0, 229, 160, 0.5)" : "none",
              transition: `background-color ${stepMs}ms ease-in-out, transform ${stepMs}ms ease-in-out, box-shadow ${stepMs}ms ease-in-out`,
            }}
          />
        );
      })}
    </div>
  );
}
