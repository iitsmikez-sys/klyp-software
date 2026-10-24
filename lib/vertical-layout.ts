export type NormalizedRect = { x: number; y: number; w: number; h: number };
export type PixelRect = { x: number; y: number; w: number; h: number };
export type VerticalLayoutV1 = {
  version: 1;
  gameplay: NormalizedRect;
  facecam?: NormalizedRect;
  chat?: NormalizedRect;
};
export type VerticalLayoutPlan =
  | { mode: "full_frame"; source: PixelRect; dest: PixelRect; output: { w: number; h: number } }
  | { mode: "composed"; panels: { name: "gameplay" | "facecam" | "chat"; source: PixelRect; dest: PixelRect }[]; output: { w: number; h: number }; textSafe: PixelRect };

export function clampSourceRect(rect: NormalizedRect): NormalizedRect {
  const w = Math.min(1, Math.max(0.05, rect.w));
  const h = Math.min(1, Math.max(0.05, rect.h));
  return { x: Math.min(1 - w, Math.max(0, rect.x)), y: Math.min(1 - h, Math.max(0, rect.y)), w, h };
}

export function chatReadabilityWarning(rect: NormalizedRect, sourceHeight: number): boolean {
  return rect.h * sourceHeight < 180;
}

function validRect(input: unknown): input is NormalizedRect {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const r = input as Record<string, unknown>;
  return [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (r.x as number) >= 0 && (r.y as number) >= 0 &&
    (r.w as number) >= 0.05 && (r.h as number) >= 0.05 &&
    (r.x as number) + (r.w as number) <= 1.000001 &&
    (r.y as number) + (r.h as number) <= 1.000001;
}

export function validateVerticalLayout(input: unknown): VerticalLayoutV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid vertical layout.");
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || !validRect(value.gameplay) ||
      (value.facecam != null && !validRect(value.facecam)) ||
      (value.chat != null && !validRect(value.chat))) throw new Error("Invalid vertical layout.");
  return {
    version: 1,
    gameplay: { ...value.gameplay },
    ...(value.facecam ? { facecam: { ...(value.facecam as NormalizedRect) } } : {}),
    ...(value.chat ? { chat: { ...(value.chat as NormalizedRect) } } : {}),
  };
}

const even = (n: number) => Math.round(n / 2) * 2;

function cropToPanel(rect: NormalizedRect, source: { w: number; h: number }, dest: PixelRect): PixelRect {
  const box = { x: rect.x * source.w, y: rect.y * source.h, w: rect.w * source.w, h: rect.h * source.h };
  const ratio = dest.w / dest.h;
  let w = box.w;
  let h = box.h;
  if (w / h > ratio) w = h * ratio;
  else h = w / ratio;
  const left = even(box.x + (box.w - w) / 2);
  const top = even(box.y + (box.h - h) / 2);
  const width = Math.max(2, Math.min(even(w), even(source.w) - left));
  const height = Math.max(2, Math.min(even(h), even(source.h) - top));
  return { x: left, y: top, w: width, h: height };
}

export function planVerticalLayout(source: { w: number; h: number }, layout: VerticalLayoutV1 | null, output: { w: number; h: number }): VerticalLayoutPlan {
  if (![source.w, source.h, output.w, output.h].every((n) => Number.isFinite(n) && n > 0 && Number.isInteger(n)) ||
      output.w % 2 || output.h % 2) throw new Error("Unsupported vertical layout dimensions.");
  if (!layout) {
    const scale = Math.min(output.w / source.w, output.h / source.h);
    const w = even(source.w * scale);
    const h = even(source.h * scale);
    return { mode: "full_frame", source: { x: 0, y: 0, w: source.w, h: source.h },
      dest: { x: even((output.w - w) / 2), y: even((output.h - h) / 2), w, h }, output };
  }
  const valid = validateVerticalLayout(layout);
  const optional = (["facecam", "chat"] as const).filter((name) => valid[name]);
  const topHeight = optional.length ? even(output.h * 0.7) : output.h;
  const destinations: { name: "gameplay" | "facecam" | "chat"; rect: NormalizedRect; dest: PixelRect }[] = [
    { name: "gameplay", rect: valid.gameplay, dest: { x: 0, y: 0, w: output.w, h: topHeight } },
  ];
  optional.forEach((name, index) => {
    const x = optional.length === 2 ? index * even(output.w / 2) : 0;
    const w = optional.length === 2 ? (index === 0 ? x + even(output.w / 2) : output.w - x) : output.w;
    destinations.push({ name, rect: valid[name]!, dest: { x, y: topHeight, w, h: output.h - topHeight } });
  });
  return { mode: "composed", output, panels: destinations.map(({ name, rect, dest }) => ({ name, source: cropToPanel(rect, source, dest), dest })),
    textSafe: { x: 0, y: 0, w: output.w, h: topHeight } };
}

/** Fixed nonvertical formats fill the output; vertical layouts retain their panel/contain contract. */
export function planClipComposition(source: { w: number; h: number }, format: "9:16" | "16:9" | "1:1" | "Original", layout: VerticalLayoutV1 | null, output: { w: number; h: number }): VerticalLayoutPlan {
  return planVerticalLayout(source, format === "9:16" ? layout : format === "Original" ? null : { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 } }, output);
}

/** Canvas dimensions must satisfy the same even-pixel contract as the renderer. */
export function previewDimensions(source: { w: number; h: number }, format: "9:16" | "16:9" | "1:1" | "Original") {
  const height = format === "Original" ? 540 * source.h / source.w : format === "16:9" ? 540 * 9 / 16 : format === "1:1" ? 540 : 960;
  return { w: 540, h: Math.max(2, even(height)) };
}
