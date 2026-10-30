import { clampSourceRect, type VerticalLayoutV1 } from './vertical-layout.ts';

export type FrameRegion = 'full' | 'gameplay' | 'facecam';

export function dragFrame(layout: VerticalLayoutV1, region: FrameRegion, dx: number, dy: number): VerticalLayoutV1 {
  if (region === 'full') {
    const fit = layout.fit ?? { zoom: 1, x: 0, y: 0 };
    return { ...layout, fit: { ...fit, x: Math.max(-1, Math.min(1, fit.x + dx)), y: Math.max(-1, Math.min(1, fit.y + dy)) } };
  }
  const rect = layout[region];
  if (!rect) return layout;
  return { ...layout, [region]: clampSourceRect({ ...rect, x: rect.x - dx * rect.w, y: rect.y - dy * rect.h }) };
}

export function zoomFrame(layout: VerticalLayoutV1, region: FrameRegion, factor: number): VerticalLayoutV1 {
  if (!Number.isFinite(factor) || factor <= 0) return layout;
  if (region === 'full') {
    const fit = layout.fit ?? { zoom: 1, x: 0, y: 0 };
    return { ...layout, fit: { ...fit, zoom: Math.max(1, Math.min(4, fit.zoom * factor)) } };
  }
  const rect = layout[region];
  if (!rect) return layout;
  const w = Math.max(.05, Math.min(1, rect.w / factor));
  const h = Math.max(.05, Math.min(1, rect.h / factor));
  return { ...layout, [region]: clampSourceRect({ ...rect, x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h }) };
}
