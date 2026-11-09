"use client";

/**
 * 16:9 poster for a saved clip, with a centred play affordance and a duration
 * badge.
 *
 * The frame comes from inside the clip's own start/end range (/api/thumbnail),
 * so two clips cut from one VOD never show the same picture. Deliberately NOT
 * the source VOD's cover image: that looked plausible while being wrong, since
 * every clip from a stream shared it. When a frame can't be produced — upload
 * still processing, VOD gone, processing service down — the card shows a plain
 * placeholder, which is honest about having no image rather than showing one
 * from a different moment.
 *
 * Generation downloads a slice of the source, so it's requested only once the
 * card is actually near the viewport, and never blocks the card from painting.
 */
import { useEffect, useRef, useState } from "react";
import { fmtTime, clipDuration, footageGone, type SavedClip } from "@/lib/clip-ui";
import { loadClipThumbnail, peekClipThumbnail, invalidateClipThumbnail } from "@/lib/clip-thumbnails";

/**
 * Only the source and range are needed, so this also accepts a clip straight
 * out of an analysis, before it has been saved to My Clips.
 */
export type ThumbnailClip = Pick<SavedClip, "url" | "start_seconds" | "end_seconds" | "title"> &
  Pick<SavedClip, "archive_status"> & { id?: string };

interface Props {
  clip: ThumbnailClip;
  /** Fires on the play button and on the poster itself. */
  onPlay: () => void;
}

type State = "idle" | "loading" | "ready" | "failed" | "gone";

/** Waits before the quiet background retries of a frame that did not arrive. */
const QUIET_RETRY_DELAYS_MS = [6_000, 15_000];

/** A calm, unique-looking backdrop for a clip whose frame is not there (yet): a soft gradient picked from its title. */
function posterBackdrop(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 32% 17%), hsl(${(h + 45) % 360} 28% 9%))`;
}

export default function ClipThumbnail({ clip, onPlay }: Props) {
  const gone = footageGone(clip);
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<State>(gone ? "gone" : "idle");
  const [retry, setRetry] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSrc(null);
    setState(gone ? "gone" : "idle");
    const box = boxRef.current;
    if (!box) return;
    // No footage anywhere: a frame cannot be produced, so don't spend a request
    // discovering that. The card says so instead.
    if (gone) { setState("gone"); return; }

    let active = true;
    // A frame that does not arrive is retried quietly in the background (a few seconds apart) and swapped in if it works.
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      // Already fetched by another card or the preview dialog — paint at once.
      const cached = peekClipThumbnail(clip);
      if (cached) {
        setSrc(cached);
        setState("ready");
        return;
      }
      setState("loading");
      loadClipThumbnail(clip)
        .then((objectUrl) => {
          if (!active) return;
          setSrc(objectUrl);
          setState("ready");
        })
        .catch(() => {
          if (!active) return;
          setState("failed");
          if (attempts < QUIET_RETRY_DELAYS_MS.length) retryTimer = setTimeout(load, QUIET_RETRY_DELAYS_MS[attempts++]);
        });
    };

    // rootMargin starts the work just before the card scrolls in, so the frame
    // is usually there by the time it's on screen.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(box);

    return () => {
      active = false;
      clearTimeout(retryTimer);
      observer.disconnect();
      // The object URL is owned by the shared cache, so it is not revoked here.
    };
  }, [clip.url, clip.start_seconds, clip.end_seconds, clip.id, gone, retry]);

  return (
    <div className="relative">
    <div
      ref={boxRef}
      onClick={(e) => { e.stopPropagation(); if (!gone) onPlay(); }}
      role="button"
      tabIndex={gone ? -1 : 0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (!gone) onPlay();
        }
      }}
      aria-label={gone ? `${clip.title} — footage no longer available` : `Preview ${clip.title}`}
      className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-2 border border-border cursor-pointer group/thumb focus:outline-none focus:ring-2 focus:ring-accent/60"
    >
      {state === "ready" && src ? (
        <img
          src={src}
          alt=""
          onError={() => { invalidateClipThumbnail(clip); setSrc(null); setState("failed"); }}
          className="w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03]"
        />
      ) : (
        <div className={`absolute inset-0 bg-surface-2 ${state === "loading" || state === "idle" ? "motion-safe:animate-pulse" : ""}`}
          style={state === "gone" ? undefined : { backgroundImage: posterBackdrop(clip.title) }}>
          {/* Bottom-left keeps this clear of the centred play button and the
              duration badge in the opposite corner. */}
          <span className="absolute bottom-2 left-2.5 flex items-center gap-1.5 text-xs text-muted">
            {state === "gone" ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
                </svg>
                Footage no longer available
              </>
            ) : state === "failed" ? "Press play to preview" : null}
          </span>
        </div>
      )}

      {/* Scrim keeps the play button and badge legible on bright frames —
          unnecessary (and muddying) over the flat placeholder. */}
      {state === "ready" && src && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20 transition-opacity group-hover/thumb:opacity-80" />
      )}

      {/* Nothing to play, so no play affordance — offering one would promise
          a preview that cannot exist. */}
      {!gone && (
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm border border-white/20 flex items-center justify-center transition-all duration-200 group-hover/thumb:bg-accent group-hover/thumb:border-accent group-hover/thumb:scale-110">
          <svg width="18" height="20" viewBox="0 0 16 18" fill="currentColor" className="ml-1 text-white group-hover/thumb:text-background">
            <polygon points="0,0 16,9 0,18" />
          </svg>
        </span>
      </div>
      )}

      <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-white text-[13px] font-semibold font-mono tabular-nums tracking-tight">
        {fmtTime(clipDuration(clip))}
      </span>
    </div>
    </div>
  );
}
