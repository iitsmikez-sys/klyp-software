"use client";
/**
 * The Pro mark for caption styles: a cyan gem with a sparkle and a check, and a short note for Free
 * users who pick a Pro style (they can preview it, but downloads use Bold). Both render nothing for
 * Pro members and for the free styles.
 */
import Link from "next/link";
import { isProCaptionStyle, type CaptionStyle } from "@/lib/clips";
import { useSparks } from "./SparksProvider";

export function ProDiamond({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <path d="M8 4h14l6 7-13 17L2 11z" fill="#2fb8dc" />
      <path d="M8 4h14l-3 7H11z" fill="#6fdcf5" />
      <path d="M2 11h9l4 17z" fill="#1f9ec4" />
      <path d="M28 11h-9l-4 17z" fill="#1788ab" />
      <path d="M11 11h8l-4 17z" fill="#45c8e8" />
      <path d="M26 2l1.3 3.2L30.5 6.5 27.3 7.8 26 11l-1.3-3.2L21.5 6.5l3.2-1.3z" fill="#fff" />
      <circle cx="24" cy="24" r="7" fill="#0f1a1f" />
      <path d="M20.5 24.2l2.5 2.5 4.6-5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The diamond for one style, shown only to Free accounts on a Pro-only style. */
export function StyleDiamond({ style, size = 18, className = "" }: { style: CaptionStyle; size?: number; className?: string }) {
  const { tier } = useSparks();
  if (tier === "pro" || !isProCaptionStyle(style)) return null;
  return <ProDiamond size={size} className={`pointer-events-none absolute ${className}`} />;
}

export function ProStyleNote({ style }: { style: CaptionStyle }) {
  const { tier } = useSparks();
  if (tier === "pro" || !isProCaptionStyle(style)) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-md border border-accent/30 bg-accent-glow px-2.5 py-2 text-[11px] leading-snug text-foreground-muted">
      <ProDiamond size={14} className="mt-px shrink-0" />
      <span>
        This is a Pro style. Preview it here; downloads use Bold until you upgrade.{" "}
        <Link href="/dashboard/upgrade" className="font-semibold text-accent underline-offset-2 hover:underline">Upgrade to Pro</Link>
      </span>
    </p>
  );
}
