"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { dragFrame, zoomFrame, type FrameRegion } from '@/lib/frame-gesture';
import { planVerticalLayout, type VerticalLayoutV1 } from '@/lib/vertical-layout';

const defaultLayout: VerticalLayoutV1 = { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 }, fit: { zoom: 1, x: 0, y: 0 } };
type Point = { x: number; y: number };
type Gesture = { base: VerticalLayoutV1; origin: Point; distance: number; region: FrameRegion; width: number; height: number };

export default function EditorFrameCanvas({ children, video, layout, onCommit, enabled }: {
  children: (previewLayout: VerticalLayoutV1 | null) => ReactNode;
  video: HTMLVideoElement | null;
  layout: VerticalLayoutV1 | null;
  onCommit: (layout: VerticalLayoutV1) => void;
  enabled: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const preview = useRef<VerticalLayoutV1 | null>(null);
  const [draft, setDraft] = useState<VerticalLayoutV1 | null>(null);
  const [selected, setSelected] = useState<FrameRegion | null>(null);
  const active = draft ?? layout;
  const selectionPlan = enabled && selected && video?.videoWidth
    ? planVerticalLayout({ w: video.videoWidth, h: video.videoHeight }, active, { w: 540, h: 960 }) : null;
  const selectedRect = selectionPlan?.mode === 'composed'
    ? selectionPlan.panels.find(panel => panel.name === selected)?.dest
    : selectionPlan?.mode === 'full_frame' ? selectionPlan.dest : null;
  const point = (event: PointerEvent) => {
    const bounds = surface.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  };
  const distance = (a: Point, b: Point) => {
    const bounds = surface.current!.getBoundingClientRect();
    return Math.hypot((a.x - b.x) * bounds.width, (a.y - b.y) * bounds.height);
  };
  const regionAt = (p: Point): { region: FrameRegion; width: number; height: number } => {
    if (!active || active.fit || !video?.videoWidth) return { region: 'full', width: 1, height: 1 };
    const plan = planVerticalLayout({ w: video.videoWidth, h: video.videoHeight }, active, { w: 540, h: 960 });
    if (plan.mode !== 'composed') return { region: 'full', width: 1, height: 1 };
    const panel = plan.panels.find(({ dest }) => p.x >= dest.x / 540 && p.x <= (dest.x + dest.w) / 540 && p.y >= dest.y / 960 && p.y <= (dest.y + dest.h) / 960);
    return { region: panel?.name === 'facecam' ? 'facecam' : 'gameplay', width: (panel?.dest.w ?? 540) / 540, height: (panel?.dest.h ?? 960) / 960 };
  };
  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !video || event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    const target = gesture.current ?? regionAt(p);
    const region = target.region;
    setSelected(region);
    pointers.current.set(event.pointerId, p);
    const values = [...pointers.current.values()];
    gesture.current = { base: preview.current ?? active ?? defaultLayout, origin: values[0], distance: values.length > 1 ? distance(values[0], values[1]) : 0, region, width: target.width, height: target.height };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    event.preventDefault();
    pointers.current.set(event.pointerId, point(event));
    const values = [...pointers.current.values()];
    const { base, origin, distance: startDistance, region, width, height } = gesture.current;
    const next = values.length > 1 && startDistance > 1
      ? zoomFrame(base, region, distance(values[0], values[1]) / startDistance)
      : dragFrame(base, region, (values[0].x - origin.x) / width, (values[0].y - origin.y) / height);
    preview.current = next;
    setDraft(next);
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (!pointers.current.size) {
      if (preview.current) onCommit(preview.current);
      preview.current = null;
      setDraft(null);
      gesture.current = null;
    } else if (gesture.current) {
      const values = [...pointers.current.values()];
      gesture.current = { ...gesture.current, base: preview.current ?? active ?? defaultLayout, origin: values[0], distance: 0 };
    }
  };
  return <div ref={surface} className="editor-frame-surface" data-enabled={enabled} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
    {children(active)}
    {selectedRect && <div className="editor-frame-selection" aria-hidden="true" style={{ left: `${selectedRect.x / 540 * 100}%`, top: `${selectedRect.y / 960 * 100}%`, width: `${selectedRect.w / 540 * 100}%`, height: `${selectedRect.h / 960 * 100}%` }} />}
    {enabled && video && <div className="editor-frame-guide" aria-hidden="true">{selected === 'facecam' ? 'Facecam' : selected === 'gameplay' ? 'Gameplay' : 'Video'} · Drag to move · Pinch to resize</div>}
  </div>;
}
