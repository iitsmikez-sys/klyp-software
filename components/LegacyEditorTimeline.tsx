"use client";

import { useRef } from "react";
import workspaceStyles from "./EditorWorkspace.module.css";
import type { EditorTimelineItem, MediaInsert } from "@/lib/editor-media";

type Cue = { startMs: number; endMs: number; text: string };
type Media = MediaInsert & { name: string; url?: string };
type Props = {
  items: EditorTimelineItem[]; media: Media[]; cues: Cue[]; peaks: number[];
  frames: string[]; poster: string | null; sourceDuration: number;
  previewDuration: number; previewLeadSeconds: number;
  duration: number; time: number; selectedSegment: number; selectedMediaIndex: number | null;
  hook: string | null; ready: boolean; exporting: boolean;
  canSplit: boolean; canDelete: boolean; canUndo: boolean; canRedo: boolean;
  onSeek: (seconds: number) => void; onSplit: () => void; onDelete: () => void;
  onUndo: () => void; onRedo: () => void;
  onSelectMedia: (index: number) => void;
  onMoveOverlay: (index: number, at: number) => void;
  onResizeOverlay: (index: number, duration: number) => void;
  onTrimSource: (index: number, edge: "start" | "end", delta: number) => void;
};

function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}

export default function EditorTimeline(props: Props) {
  const { items, media, cues, peaks, frames, poster, sourceDuration, previewDuration,
    previewLeadSeconds, duration, time, selectedSegment, selectedMediaIndex, hook, ready, exporting,
    canSplit, canDelete, canUndo, canRedo, onSeek, onSplit, onDelete, onUndo, onRedo,
    onSelectMedia, onMoveOverlay, onResizeOverlay, onTrimSource } = props;
  const drag = useRef<{ index: number; edge: "start" | "end"; x: number } | null>(null);
  const overlayDrag = useRef<{ index: number; edge: "move" | "end"; x: number } | null>(null);
  const safeDuration = Math.max(duration, 0.1);
  const pct = (seconds: number) => `${Math.max(0, Math.min(100, seconds / safeDuration * 100))}%`;
  const tick = duration <= 30 ? 5 : duration <= 90 ? 10 : 15;
  const ticks = Array.from({ length: Math.floor(duration / tick) + 1 }, (_, index) => index * tick);
  const lane = "relative min-w-0 border-b border-[#183039] bg-[#091820]";
  const row = "grid grid-cols-[112px_minmax(0,1fr)]";
  const label = "sticky left-0 z-20 flex items-center gap-2 border-r border-[#263740] bg-[#08131a] px-3 text-xs font-medium text-[#e0ebef]";
  const seekFromLane = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!ready || (event.target !== event.currentTarget && event.currentTarget.dataset.track !== "audio")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek((event.clientX - rect.left) / rect.width * duration);
  };
  const overlayPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const action = overlayDrag.current;
    overlayDrag.current = null;
    if (!action) return;
    const laneElement = event.currentTarget.closest("[data-track='images']");
    if (!(laneElement instanceof HTMLElement)) return;
    const delta = (event.clientX - action.x) / laneElement.getBoundingClientRect().width * duration;
    if (Math.abs(delta) < 0.05) return;
    const item = media[action.index];
    if (action.edge === "move") onMoveOverlay(action.index, Math.max(0, Math.min(duration - item.duration, item.at! + delta)));
    else onResizeOverlay(action.index, Math.max(0.1, Math.min(duration - item.at!, item.duration + delta)));
  };
  const trimPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const action = drag.current;
    drag.current = null;
    if (!action) return;
    const laneElement = event.currentTarget.closest("[data-track='video']");
    if (!(laneElement instanceof HTMLElement)) return;
    const delta = (event.clientX - action.x) / laneElement.getBoundingClientRect().width * duration;
    if (Math.abs(delta) < 0.05) return;
    onTrimSource(action.index, action.edge, delta);
  };

  return <section aria-label="Video timeline" className={`${workspaceStyles.timeline} shrink-0 border-t border-[#24404a] bg-[#071218] overflow-x-auto overflow-y-auto`}>
    <div className="min-w-[760px] px-0 pb-3">
      <div className="sticky top-0 z-30 flex h-9 items-center justify-between border-b border-[#25414a] bg-[#091820] px-3">
        <div className="flex items-center gap-1 text-xs text-[#e2edf0]">
          <button type="button" onClick={onSplit} disabled={!canSplit || exporting} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-35">✂ <span className="ml-1">Split</span></button>
          <button type="button" onClick={onDelete} disabled={!canDelete || exporting} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-35">▤ <span className="ml-1">Delete</span></button>
          <span className="mx-1 h-4 border-l border-[#35505a]" />
          <button type="button" onClick={onUndo} disabled={!canUndo || exporting} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-35">↶ <span className="ml-1">Undo</span></button>
          <button type="button" onClick={onRedo} disabled={!canRedo || exporting} className="rounded px-2 py-1 hover:bg-white/10 disabled:opacity-35">↷ <span className="ml-1">Redo</span></button>
        </div>
        <div className="font-mono text-[11px] text-[#9db0b9]">{clock(time)} / {clock(duration)}</div>
      </div>

      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-[112px] right-0 z-10">
          <span className="absolute inset-y-0 w-[2px] bg-white shadow-[0_0_9px_#fff]" style={{ left: pct(time) }}>
            <span className="absolute -left-5 -top-[2px] rounded bg-white px-1 py-0.5 font-mono text-[10px] text-black">{clock(time)}</span>
          </span>
        </div>
        <div className={`${row} h-7`}>
          <div className={`${label} text-[#a7bac2]`}>Timeline</div>
          <div className="relative cursor-crosshair border-b border-[#2a4149] bg-[#0b1b22]" onClick={seekFromLane}>
            {ticks.map((seconds) => <span key={seconds} className="absolute bottom-0 top-0 border-l border-[#526873] pl-1 pt-1 font-mono text-[10px] text-[#a7bac2]" style={{ left: pct(seconds) }}>{clock(seconds)}</span>)}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_20px,#38515b_20px,#38515b_21px)]" />
          </div>
        </div>
        <div className={`${row} h-7`}>
          <div className={label}><span className="text-base">T</span> Hook (Text)</div>
          <div className={lane} onClick={seekFromLane}>
            {hook && <button type="button" onClick={() => onSeek(0)} style={{ left: 0, width: pct(Math.min(3, duration)) }}
              className="absolute top-1 h-6 truncate rounded border border-[#67efc6] bg-[#42dcb3] px-2 text-left text-[10px] font-semibold text-[#08271f]">T&nbsp; {hook}</button>}
          </div>
        </div>
        <div className={`${row} h-9`}>
          <div className={label}><span className="text-base">▤</span> Captions</div>
          <div className={lane} onClick={seekFromLane}>
            {cues.map((cue, index) => <button type="button" key={index} onClick={() => onSeek(cue.startMs / 1000)}
              title={cue.text} style={{ left: pct(cue.startMs / 1000), width: pct(Math.max(0.1, (cue.endMs - cue.startMs) / 1000)) }}
              className="absolute top-1 h-8 overflow-hidden truncate rounded border border-[#28a98a] bg-[#064f41] px-1.5 text-left text-[10px] text-[#ddfff2]">{cue.text}</button>)}
          </div>
        </div>
        <div className={`${row} h-11`}>
          <div className={label}><span className="text-base">▣</span> Video</div>
          <div data-track="video" className={`${lane} cursor-crosshair`} onClick={seekFromLane}>
            {items.map((item, index) => {
              const selected = item.kind === "source" ? selectedMediaIndex === null && selectedSegment === item.sourceIndex : selectedMediaIndex === item.mediaIndex;
              const count = item.kind === "source" ? Math.max(1, Math.ceil((item.end - item.start) / 2)) : 1;
              const previousSource = items.find((entry) => entry.kind === "source" && entry.sourceIndex === item.sourceIndex! - 1);
              const nextSource = items.find((entry) => entry.kind === "source" && entry.sourceIndex === item.sourceIndex! + 1);
              return <div key={`${item.kind}-${item.id ?? item.sourceIndex}-${index}`}
                style={{ left: pct(item.start), width: pct(item.end - item.start) }}
                className={`absolute top-0 h-[44px] border-r border-[#6b8891]/50 ${selected ? "ring-2 ring-inset ring-[#53edc3] z-[2]" : "hover:ring-1 hover:ring-inset hover:ring-white/60"}`}>
                <button type="button"
                  onClick={() => item.kind === "source" ? onSeek(item.start + 0.01) : onSelectMedia(item.mediaIndex!)}
                  aria-label={item.kind === "source" ? `Select video section ${item.sourceIndex! + 1}` : `Select imported ${item.kind}`}
                  aria-pressed={selected} className="absolute inset-0 w-full overflow-hidden text-left">
                <span className="flex h-full w-full">
                  {Array.from({ length: count }, (_, frameIndex) => {
                    const sourceTime = item.sourceStart! + (frameIndex + 0.5) / count * (item.sourceEnd! - item.sourceStart!);
                    const frame = frames.length ? frames[Math.min(frames.length - 1, Math.floor(sourceTime / Math.max(sourceDuration, 0.1) * frames.length))] : poster;
                    const image = item.kind === "source" ? frame : media[item.mediaIndex!]?.url;
                    return image ? <img key={frameIndex} src={image} alt="" className="h-full min-w-0 flex-1 object-cover" />
                      : <span key={frameIndex} className="h-full min-w-0 flex-1 bg-[#284759]" />;
                  })}
                </span>
                {item.kind !== "source" && <span className="absolute inset-x-0 bottom-0 truncate bg-violet-950/80 px-1 text-[9px] text-white">{media[item.mediaIndex!]?.name}</span>}
                </button>
                {selected && item.kind === "source" && (["start", "end"] as const).map((edge) =>
                  <span key={edge} role="slider" tabIndex={0} aria-label={`Trim ${edge} of section ${item.sourceIndex! + 1}`}
                    aria-valuemin={edge === "start" ? previousSource?.sourceEnd ?? 0 : item.sourceStart! + 0.1}
                    aria-valuemax={edge === "start" ? item.sourceEnd! - 0.1 : nextSource?.sourceStart ?? sourceDuration}
                    aria-valuenow={edge === "start" ? item.sourceStart : item.sourceEnd}
                    aria-valuetext={`${(edge === "start" ? item.sourceStart! : item.sourceEnd!).toFixed(1)} seconds in source video`}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => { event.stopPropagation(); drag.current = { index: item.sourceIndex!, edge, x: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); }}
                    onPointerUp={trimPointerUp}
                    onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onTrimSource(item.sourceIndex!, edge, event.key === "ArrowLeft" ? -0.1 : 0.1); } }}
                    className={`absolute ${edge === "start" ? "left-0" : "right-0"} top-0 z-10 h-full w-[7px] cursor-ew-resize rounded-sm bg-[#55f2c9]`} />)}
              </div>;
            })}
          </div>
        </div>
        <div className={`${row} h-9`}>
          <div className={label}><span className="text-base">▧</span> Images</div>
          <div data-track="images" className={`${lane} cursor-crosshair`} onClick={seekFromLane}>
            {media.map((item, index) => item.placement === "overlay" && <div key={item.id}
              style={{ left: pct(item.at!), width: pct(item.duration) }}
              className={`absolute top-1 h-8 rounded border border-violet-400 bg-violet-700 ${selectedMediaIndex === index ? "ring-2 ring-white" : ""}`}>
              <button type="button" onClick={() => onSelectMedia(index)}
                aria-label={`Photo overlay ${item.name}`} aria-pressed={selectedMediaIndex === index}
                onPointerDown={(event) => { overlayDrag.current = { index, edge: "move", x: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerUp={overlayPointerUp}
                className="absolute inset-0 flex w-full items-center gap-1 overflow-hidden truncate px-2 text-left text-[10px] text-white">
                ▧ <span className="truncate">{item.name}</span>
                {item.url && <img src={item.url} alt="" className="ml-auto h-6 w-8 object-cover" />}
              </button>
              <span role="slider" tabIndex={0} aria-label={`Resize photo ${item.name}`} aria-valuemin={0.1} aria-valuemax={duration - item.at!} aria-valuenow={item.duration}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => { event.stopPropagation(); overlayDrag.current = { index, edge: "end", x: event.clientX }; event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerUp={(event) => { event.stopPropagation(); overlayPointerUp(event); }}
                onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onResizeOverlay(index, item.duration + (event.key === "ArrowLeft" ? -0.1 : 0.1)); } }}
                className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize bg-violet-200" />
            </div>)}
          </div>
        </div>
        <div className={`${row} h-9`}>
          <div className={label}><span className="text-base">♫</span> Audio</div>
          <div data-track="audio" className={`${lane} flex items-center overflow-hidden bg-[#06372f]`} onClick={seekFromLane}>
            {items.map((item, index) => <div key={index} style={{ width: pct(item.end - item.start) }} className="flex h-full items-center overflow-hidden border-r border-[#136e5c]/60">
              {item.kind === "source" && Array.from({ length: Math.max(3, Math.ceil((item.end - item.start) / safeDuration * 220)) }, (_, bar) => {
                const fraction = bar / Math.max(1, Math.ceil((item.end - item.start) / safeDuration * 220) - 1);
                const sourceTime = item.sourceStart! + fraction * (item.sourceEnd! - item.sourceStart!);
                const sample = peaks[Math.min(peaks.length - 1, Math.max(0, Math.floor((sourceTime + previewLeadSeconds) / Math.max(previewDuration, 0.1) * peaks.length)))] ?? 0.25;
                return <span key={bar} className="min-w-px flex-1 bg-[#26d9a6]" style={{ height: `${Math.max(8, Math.min(90, sample * 150))}%` }} />;
              })}
            </div>)}
          </div>
        </div>
      </div>
    </div>
  </section>;
}
