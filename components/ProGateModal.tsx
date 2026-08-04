"use client";

/** Upgrade prompt shown when a free user taps a Pro-only action. */
export default function ProGateModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-surface border border-accent/40 rounded-2xl p-7 shadow-accent-glow text-center animate-fade-in">
        <div className="w-12 h-12 mx-auto rounded-full bg-accent-glow flex items-center justify-center mb-4">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.4 6.9H21l-5.4 4.2 2 7-5.6-4.3L6.4 20l2-7L3 8.9h6.6z" />
          </svg>
        </div>
        <h3 className="font-syne text-lg font-bold text-foreground mb-2">This is a Pro feature</h3>
        <p className="text-sm text-foreground-muted leading-relaxed mb-6">
          Upgrade to remove watermarks, publish directly, upscale clips and more.{" "}
          <span className="text-foreground font-semibold">$29/month</span>
        </p>
        <a
          href="/dashboard/upgrade"
          className="block w-full py-2.5 rounded-xl bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm"
        >
          Upgrade to Pro
        </a>
        <button
          onClick={onClose}
          className="mt-2 w-full py-2.5 rounded-xl text-sm font-medium text-foreground-muted hover:text-foreground transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
