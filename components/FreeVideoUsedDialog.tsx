"use client";

import { useEffect, useState } from "react";
import ProOfferCta from "@/components/ProOfferCta";
import OutOfSparksDialog, { type PendingVideo } from "@/components/OutOfSparksDialog";
import { trackEvent } from "@/lib/track";

/** The picture at the top. If the file is not there, a plain Klyp banner is shown instead. */
export const FREE_VIDEO_IMAGE = "/second-video.png";

/**
 * Shown to a Free account that tries another video after using its free one (not enough Sparks for it). The first thing it offers is
 * the Pro pass, one click to checkout with the $28 and the cancel rule beside it; buying a few Sparks is still there, one step away.
 * Pro accounts never see this one (they get the Spark packs dialog).
 */
export default function FreeVideoUsedDialog({ balance, video, onClose }: { balance: number | null; video?: PendingVideo | null; onClose: () => void }) {
  const [showPacks, setShowPacks] = useState(false);
  const [imageOk, setImageOk] = useState(true);
  const [thumbOk, setThumbOk] = useState(true);

  useEffect(() => { void trackEvent("free_video_used_view", { cost: video?.cost ?? null, balance }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (showPacks) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, showPacks]);

  if (showPacks) return <OutOfSparksDialog isPro={false} balance={balance} video={video} onClose={onClose} />;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="free-video-used-title" data-free-video-used-dialog onClick={onClose}>
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-foreground-muted transition-colors hover:text-foreground">✕</button>
        {imageOk
          ? <img src={FREE_VIDEO_IMAGE} alt="" onError={() => setImageOk(false)} className="h-auto w-full object-cover" />
          : <div className="flex h-28 items-center justify-center bg-accent-glow font-syne text-3xl font-bold text-foreground">kl<span className="text-accent">yp</span></div>}
        <div className="p-6">
          <h3 id="free-video-used-title" className="font-syne text-xl font-bold text-foreground">You've used your free video</h3>
          <p className="mt-1 text-sm leading-relaxed text-foreground-muted">
            {video ? "This one is ready to clip. Run it with a Pro pass." : "Run your next video with a Pro pass."}
          </p>
          {video && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-background/50 p-2.5" data-pending-video>
              <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                {video.thumbnail && thumbOk
                  ? <img src={video.thumbnail} alt="" onError={() => setThumbOk(false)} className="h-full w-full object-cover" />
                  : <span aria-hidden="true" className="text-lg">▶</span>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{video.title}</p>
                <p className="mt-0.5 text-xs text-foreground-muted">{video.platform} · {video.duration}</p>
              </div>
            </div>
          )}
          <ProOfferCta source="free_video_used" fallbackLabel="See the Pro plans" />
          <div className="mt-4 border-t border-border pt-3 text-center">
            <button type="button" data-free-video-packs onClick={() => { void trackEvent("free_video_used_packs", {}); setShowPacks(true); }}
              className="text-[13px] text-foreground-muted underline underline-offset-2 hover:text-foreground">Just need a few Sparks? See Spark packs</button>
          </div>
        </div>
      </div>
    </div>
  );
}
