"use client";

import { useEffect } from "react";

/** Shown when someone clicks to another page while their clips are not saved yet. */
export default function UnsavedClipsDialog({ count, keptDays, isPro, saving, onStay, onLeave, onSaveAll }: {
  count: number; keptDays: number; isPro: boolean; saving: boolean;
  onStay: () => void; onLeave: () => void; onSaveAll: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onStay(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStay]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-clips-title" data-unsaved-dialog>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <h3 id="unsaved-clips-title" className="font-syne text-lg font-bold text-foreground">You have clips that aren&apos;t saved</h3>
        <p className="mt-2 text-sm text-foreground-muted">
          Your {count} clip{count === 1 ? "" : "s"} will be kept for {keptDays} days{isPro ? "" : " on the free plan"}, so you can come back to them.
          Save them now to keep them in your library.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onLeave} disabled={saving} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted transition-colors hover:text-foreground disabled:opacity-50">Leave</button>
          <button type="button" onClick={onSaveAll} disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-background transition-colors hover:bg-accent-dim disabled:opacity-50">{saving ? "Saving…" : "Save all clips"}</button>
        </div>
        <button type="button" onClick={onStay} className="mt-3 w-full text-center text-xs text-foreground-muted underline underline-offset-2 hover:text-foreground">Stay on this page</button>
      </div>
    </div>
  );
}
