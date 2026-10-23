"use client";

import { useEffect, useRef, useState } from "react";
import { chatReadabilityWarning, clampSourceRect, type NormalizedRect, type VerticalLayoutV1 } from "@/lib/vertical-layout";
import VerticalLayoutPreview from "./VerticalLayoutPreview";
import type { HookStyle } from "@/lib/captions";
import type { CaptionStyle, TimedWord } from "@/lib/clips";

const initial: VerticalLayoutV1 = { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 } };
const colors = { gameplay: "#50e3ae", facecam: "#b688f7", chat: "#ffbf69" };
type Region = "gameplay" | "facecam" | "chat";

export default function VerticalLayoutEditor({ sourceUrl, layout, onChange, onSave, saving = false, text }: {
  sourceUrl: string | null;
  layout: VerticalLayoutV1 | null;
  onChange: (value: VerticalLayoutV1) => void;
  onSave?: () => void;
  saving?: boolean;
  text?: { hook: string; hookStyle: HookStyle; captionStyle: CaptionStyle; words: TimedWord[] | null; videoTrimStart: number; vodStart: number; vodEnd: number };
}) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ region: Region; x: number; y: number; rect: NormalizedRect } | null>(null);
  const current = layout ?? initial;

  const setRegion = (region: Region, rect: NormalizedRect | null) => {
    const next = { ...current };
    if (region === "gameplay") next.gameplay = clampSourceRect(rect ?? initial.gameplay);
    else if (rect) next[region] = clampSourceRect(rect);
    else delete next[region];
    onChange(next);
  };

  useEffect(() => {
    if (!sourceUrl) setVideo(null);
  }, [sourceUrl]);

  const move = (event: React.PointerEvent) => {
    if (!dragRef.current || !frameRef.current) return;
    const { region, x, y, rect } = dragRef.current;
    const bounds = frameRef.current.getBoundingClientRect();
    setRegion(region, { ...rect, x: rect.x + (event.clientX - x) / bounds.width, y: rect.y + (event.clientY - y) / bounds.height });
  };

  return <div className="space-y-3">
    <p className="text-xs text-foreground-muted">Pause at the payoff. Drag the colored boxes over gameplay, facecam and chat already in your VOD.</p>
    {sourceUrl ? <div className="flex flex-col sm:flex-row gap-4 items-start">
      <div className="w-full sm:flex-1 min-w-0">
        <div ref={frameRef} className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: video?.videoWidth && video?.videoHeight ? `${video.videoWidth}/${video.videoHeight}` : "16/9" }} onPointerMove={move} onPointerUp={() => { dragRef.current = null; }}>
          <video src={sourceUrl} playsInline className="w-full h-full object-contain" onLoadedMetadata={(event) => setVideo(event.currentTarget)} />
          {(["gameplay", "facecam", "chat"] as const).map((region) => {
            const rect = current[region];
            if (!rect) return null;
            return <div key={region} onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { region, x: event.clientX, y: event.clientY, rect };
            }} onPointerMove={move} onPointerUp={() => { dragRef.current = null; }}
              className="absolute cursor-move border-2 font-bold text-[10px] text-white bg-black/20 touch-none" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, borderColor: colors[region] }}>
              <span className="bg-black/70 px-1">{region}</span>
            </div>;
          })}
        </div>
        {video && <div className="flex items-center gap-2 mt-2"><button type="button" className="border border-border rounded px-2 py-1" onClick={() => video.paused ? video.play() : video.pause()}>{video.paused ? "Play" : "Pause"}</button><input className="flex-1" type="range" min="0" max={Math.max(1, video.duration || 1)} step="0.1" defaultValue="0" onChange={(event) => { video.currentTime = Number(event.target.value); }} aria-label="Seek sample video" /></div>}
        <p className="text-[11px] text-subtle mt-1">Use the controls below to resize each box.</p>
      </div>
      <VerticalLayoutPreview video={video} layout={layout} text={text} />
    </div> : <p className="text-xs text-amber-300">Choose a sample video to mark the layout.</p>}
    <div className="space-y-2">
      {(["gameplay", "facecam", "chat"] as const).map((region) => {
        const rect = current[region];
        return <div key={region} className="rounded-lg border border-border p-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="capitalize font-semibold" style={{ color: colors[region] }}>{region}</span>
            {region !== "gameplay" && <label className="flex items-center gap-1"><input type="checkbox" checked={!!rect} onChange={(event) => setRegion(region, event.target.checked ? { x: region === "facecam" ? 0 : 0.75, y: 0.55, w: 0.25, h: 0.4 } : null)} /> Include</label>}
          </div>
          {rect && <div className="grid grid-cols-2 gap-2 mt-2">{(["w", "h"] as const).map((axis) => <label key={axis} className="flex items-center gap-2">{axis === "w" ? "Width" : "Height"}<input className="flex-1 min-w-0" type="range" min="0.05" max="1" step="0.01" value={rect[axis]} onChange={(event) => setRegion(region, { ...rect, [axis]: Number(event.target.value) })} /></label>)}</div>}
          {region === "chat" && rect && video && chatReadabilityWarning(rect, video.videoHeight) && <p className="text-amber-300 mt-1">Chat may be too small to read. Make its box taller or leave it out.</p>}
        </div>;
      })}
    </div>
    {onSave && <button type="button" onClick={onSave} disabled={!sourceUrl || saving} className="rounded-lg bg-accent text-background px-4 py-2 text-xs font-bold disabled:opacity-50">{saving ? "Saving…" : "Save my vertical layout"}</button>}
  </div>;
}
