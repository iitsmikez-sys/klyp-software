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
import { fmtTime, clipDuration, type SavedClip } from "@/lib/clip-ui";
import { processingFetch } from "@/lib/processing-api";

interface Props {
  clip: SavedClip;
  /** Fires on the play button and on the poster itself. */
  onPlay: () => void;
}

type State = "idle" | "loading" | "ready" | "failed";

export default function ClipThumbnail({ clip, onPlay }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<State>("idle");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    let objectUrl: string | null = null;
    let done = false;

    const load = () => {
      if (done) return;
      done = true;
      setState("loading");
      processingFetch("/api/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: clip.url,
          start_seconds: clip.start_seconds,
          end_seconds: clip.end_seconds,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.blob();
        })
        .then((blob) => {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
          setState("ready");
        })
        .catch(() => setState("failed"));
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
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clip.url, clip.start_seconds, clip.end_seconds]);

  return (
    <div
      ref={boxRef}
      onClick={(e) => { e.stopPropagation(); onPlay(); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onPlay();
        }
      }}
      aria-label={`Preview ${clip.title}`}
      className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-2 border border-border cursor-pointer group/thumb focus:outline-none focus:ring-2 focus:ring-accent/60"
    >
      {state === "ready" && src ? (
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-surface-2 via-surface to-background">
          {/* Bottom-left keeps this clear of the centred play button and the
              duration badge in the opposite corner. */}
          <span className="absolute bottom-2 left-2.5 flex items-center gap-1.5 text-xs text-muted">
            {state === "loading" ? (
              <>
                <span className="w-3 h-3 rounded-full border border-muted border-t-transparent animate-spin" />
                Loading frame…
              </>
            ) : state === "failed" ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
                No preview frame
              </>
            ) : null}
          </span>
        </div>
      )}

      {/* Scrim keeps the play button and badge legible on bright frames —
          unnecessary (and muddying) over the flat placeholder. */}
      {state === "ready" && src && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20 transition-opacity group-hover/thumb:opacity-80" />
      )}

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm border border-white/20 flex items-center justify-center transition-all duration-200 group-hover/thumb:bg-accent group-hover/thumb:border-accent group-hover/thumb:scale-110">
          <svg width="18" height="20" viewBox="0 0 16 18" fill="currentColor" className="ml-1 text-white group-hover/thumb:text-background">
            <polygon points="0,0 16,9 0,18" />
          </svg>
        </span>
      </div>

      <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-white text-[13px] font-semibold font-mono tabular-nums tracking-tight">
        {fmtTime(clipDuration(clip))}
      </span>
    </div>
  );
}
