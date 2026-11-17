"use client";

import { RAW_PRO_TITLE, RAW_PRO_BODY } from "@/lib/raw-pro";

/** Shown when a Free member taps Download Raw: Raw is the clean cut with no watermark, a Pro feature. */
export default function RawProModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="raw-pro-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm animate-fade-in rounded-2xl border border-accent/40 bg-surface p-7 text-center shadow-accent-glow">
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">Pro feature</p>
        <h3 id="raw-pro-title" className="mt-1 font-syne text-xl font-bold text-foreground">{RAW_PRO_TITLE}</h3>
        <p className="mb-6 mt-2 text-sm leading-relaxed text-foreground-muted">{RAW_PRO_BODY}</p>
        <a
          href="/dashboard/upgrade"
          className="block w-full rounded-xl bg-accent py-2.5 font-syne text-sm font-bold text-background shadow-accent-glow-sm transition-colors hover:bg-accent-dim"
        >
          See Pro plans
        </a>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full rounded-xl py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
