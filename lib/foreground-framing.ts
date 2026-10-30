import type { ForegroundTransform, VerticalLayoutV1 } from './vertical-layout.ts';

export const defaultForeground: ForegroundTransform = { scale: 1, x: .5, y: .5 };
export const fullFrameLayout = (foreground: ForegroundTransform): VerticalLayoutV1 =>
  ({ version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 }, foreground });

export function canTransformForeground(layout: VerticalLayoutV1 | null): boolean {
  return !layout || (!layout.fit && !layout.facecam && !layout.chat && layout.gameplay.x === 0 && layout.gameplay.y === 0 && layout.gameplay.w === 1 && layout.gameplay.h === 1);
}

export function resizeForeground(current: ForegroundTransform, multiplier: number): ForegroundTransform {
  return { ...current, scale: Math.max(1, Math.min(4, Math.round(current.scale * multiplier * 100) / 100)) };
}

export function moveForeground(current: ForegroundTransform, dx: number, dy: number, output: { w: number; h: number }, fit: { w: number; h: number }): ForegroundTransform {
  const travelX = output.w - fit.w * current.scale;
  const travelY = output.h - fit.h * current.scale;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    ...current,
    x: Math.abs(travelX) < 1 ? current.x : clamp(current.x + dx / travelX),
    y: Math.abs(travelY) < 1 ? current.y : clamp(current.y + dy / travelY),
  };
}
