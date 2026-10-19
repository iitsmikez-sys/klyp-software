"use client";

/**
 * 16:9 poster for a saved clip, with a centered play affordance and a duration
 * badge. Klyp doesn't store rendered clip files or per-clip stills, so the
 * image is the source VOD's own poster (Twitch via /api/vod-thumbnails,
 * YouTube from the video id). Anything we can't resolve — uploads, a Twitch
 * VOD still processing, a dead image — falls back to a branded placeholder
 * rather than a broken frame.
 */
import { useState } from "react";
import { fmtTime, clipDuration, type SavedClip } from "@/lib/clip-ui";

interface Props {
  clip: SavedClip;
  /** Resolved poster URL, or null while loading / when none exists. */
  thumbnailUrl: string | null;
  /** Fires on the play button and on the poster itself. */
  onPlay: () => void;
}

export default function ClipThumbnail({ clip, thumbnailUrl, onPlay }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = thumbnailUrl !== null && !failed;

  return (
    <div
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
      {showImage ? (
        <img
          src={thumbnailUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover/thumb:scale-[1.03]"
        />
      ) : (
        /* No poster — e.g. an uploaded VOD, or a Twitch VOD that has since
           expired. Reads as deliberate artwork rather than a dead black box. */
        <div className="absolute inset-0 bg-gradient-to-br from-surface-2 via-surface to-background">
          {/* Bottom-left keeps this clear of the centred play button and the
              duration badge in the opposite corner. */}
          <span className="absolute bottom-2 left-2.5 flex items-center gap-1.5 text-xs text-muted">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            No preview image
          </span>
        </div>
      )}

      {/* Scrim keeps the play button and badge legible on bright frames —
          unnecessary (and muddying) over the flat fallback. */}
      {showImage && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20 transition-opacity group-hover/thumb:opacity-80" />
      )}

      {/* Centered play / close control */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="w-14 h-14 rounded-full bg-black/55 backdrop-blur-sm border border-white/20 flex items-center justify-center transition-all duration-200 group-hover/thumb:bg-accent group-hover/thumb:border-accent group-hover/thumb:scale-110">
          <svg width="18" height="20" viewBox="0 0 16 18" fill="currentColor" className="ml-1 text-white group-hover/thumb:text-background">
            <polygon points="0,0 16,9 0,18" />
          </svg>
        </span>
      </div>

      {/* Duration badge */}
      <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/80 text-white text-[13px] font-semibold font-mono tabular-nums tracking-tight">
        {fmtTime(clipDuration(clip))}
      </span>
    </div>
  );
}
