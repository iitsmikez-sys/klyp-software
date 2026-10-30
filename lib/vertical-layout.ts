export type NormalizedRect = { x: number; y: number; w: number; h: number };
export type PixelRect = { x: number; y: number; w: number; h: number };
export function visibleFrameRect(rect: PixelRect, output: { w: number; h: number }): PixelRect {
  const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
  const right = Math.min(output.w, rect.x + rect.w), bottom = Math.min(output.h, rect.y + rect.h);
  return right > x && bottom > y ? { x, y, w: right - x, h: bottom - y } : { x: 0, y: 0, w: output.w, h: output.h };
}
export type ForegroundTransform = { scale: number; x: number; y: number };
export type VerticalLayoutV1 = {
  version: 1;
  gameplay: NormalizedRect;
  facecam?: NormalizedRect;
  chat?: NormalizedRect;
  arrangement?: "gameplay_top" | "facecam_top";
  focus?: "reaction";
  foreground?: ForegroundTransform;
  mainShare?: number;
  fit?: { zoom: number; x: number; y: number };
};
export type VerticalLayoutPlan =
  | { mode: "full_frame"; source: PixelRect; dest: PixelRect; output: { w: number; h: number }; textSafe: PixelRect; transformed?: boolean }
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

function validForeground(input: unknown): input is ForegroundTransform {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return [value.scale, value.x, value.y].every(n => typeof n === "number" && Number.isFinite(n)) &&
    (value.scale as number) >= 1 && (value.scale as number) <= 4 &&
    (value.x as number) >= 0 && (value.x as number) <= 1 &&
    (value.y as number) >= 0 && (value.y as number) <= 1;
}

export function validateVerticalLayout(input: unknown): VerticalLayoutV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid vertical layout.");
  const value = input as Record<string, unknown>;
  if (value.version !== 1 || !validRect(value.gameplay) ||
      (value.facecam != null && !validRect(value.facecam)) ||
      (value.chat != null && !validRect(value.chat)) ||
      (value.mainShare != null && (typeof value.mainShare !== "number" || !Number.isFinite(value.mainShare) || value.mainShare < 0.35 || value.mainShare > 0.8)) ||
      (value.fit != null && (!value.fit || typeof value.fit !== "object" || Array.isArray(value.fit) ||
        !["zoom", "x", "y"].every((key) => typeof (value.fit as Record<string, unknown>)[key] === "number" && Number.isFinite((value.fit as Record<string, number>)[key])) ||
        (value.fit as { zoom: number }).zoom < 1 || (value.fit as { zoom: number }).zoom > 4 ||
        Math.abs((value.fit as { x: number }).x) > 1 || Math.abs((value.fit as { y: number }).y) > 1)) ||
      (value.arrangement != null && value.arrangement !== "gameplay_top" && value.arrangement !== "facecam_top") ||
      (value.focus != null && value.focus !== "reaction") ||
      (value.foreground != null && (!validForeground(value.foreground) || !!value.fit || !!value.facecam || !!value.chat ||
        (value.gameplay as NormalizedRect).x !== 0 || (value.gameplay as NormalizedRect).y !== 0 ||
        (value.gameplay as NormalizedRect).w !== 1 || (value.gameplay as NormalizedRect).h !== 1))) throw new Error("Invalid vertical layout.");
  return {
    version: 1,
    gameplay: { ...value.gameplay },
    ...(value.facecam ? { facecam: { ...(value.facecam as NormalizedRect) } } : {}),
    ...(value.chat ? { chat: { ...(value.chat as NormalizedRect) } } : {}),
    ...(value.arrangement ? { arrangement: value.arrangement as VerticalLayoutV1["arrangement"] } : {}),
    ...(value.focus ? { focus: "reaction" as const } : {}),
    ...(value.foreground ? { foreground: { ...(value.foreground as ForegroundTransform) } } : {}),
    ...(value.mainShare != null ? { mainShare: value.mainShare as number } : {}),
    ...(value.fit ? { fit: { ...(value.fit as { zoom: number; x: number; y: number }) } } : {}),
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
  const valid = layout ? validateVerticalLayout(layout) : null;
  if (!valid || (valid.fit && !valid.facecam && !valid.chat)) {
    const fit = valid?.fit ?? { zoom: 1, x: 0, y: 0 };
    const scale = Math.min(output.w / source.w, output.h / source.h) * fit.zoom;
    const w = even(source.w * scale);
    const h = even(source.h * scale);
    const dest = { x: even((output.w - w) / 2 + fit.x * output.w), y: even((output.h - h) / 2 + fit.y * output.h), w, h };
    return { mode: "full_frame", source: { x: 0, y: 0, w: source.w, h: source.h }, dest, output, textSafe: visibleFrameRect(dest, output), transformed: !!valid?.fit };
  }
  // A full-source gameplay box is not permission to discard its side content.
  // A narrower user-marked box still opts into the composed crop.
  if (output.h > output.w && !valid.facecam && !valid.chat && valid.gameplay.x === 0 && valid.gameplay.y === 0 && valid.gameplay.w === 1 && valid.gameplay.h === 1) {
    const fit = planVerticalLayout(source, null, output);
    if (fit.mode !== "full_frame" || !valid.foreground) return fit;
    const transform = valid.foreground;
    const w = Math.max(2, even(fit.dest.w * transform.scale));
    const h = Math.max(2, even(fit.dest.h * transform.scale));
    const x = even((output.w - w) * transform.x);
    const y = even((output.h - h) * transform.y);
    const visibleX = Math.max(0, x), visibleY = Math.max(0, y);
    return { ...fit, dest: { x, y, w, h }, transformed: true,
      textSafe: { x: visibleX, y: visibleY, w: Math.min(output.w, x + w) - visibleX, h: Math.min(output.h, y + h) - visibleY } };
  }
  if (valid.focus === "reaction" && valid.facecam) {
    const faceHeight = even(output.h * 0.7);
    const faceDest = { x: 0, y: 0, w: output.w, h: faceHeight };
    const gameDest = { x: 0, y: faceHeight, w: output.w, h: output.h - faceHeight };
    return { mode: "composed", output, panels: [
      { name: "facecam", source: cropToPanel(valid.facecam, source, faceDest), dest: faceDest },
      { name: "gameplay", source: cropToPanel(valid.gameplay, source, gameDest), dest: gameDest },
    ], textSafe: gameDest };
  }
  const optional = (["facecam", "chat"] as const).filter((name) => valid[name]);
  const facecamFirst = valid.arrangement === "facecam_top" && !!valid.facecam;
  // A marked facecam gets more space while gameplay keeps the majority.
  const topHeight = optional.length ? even(output.h * (valid.mainShare ?? (facecamFirst ? 0.6 : 0.7))) : output.h;
  const smallBandY = facecamFirst ? 0 : topHeight;
  const mainY = facecamFirst ? output.h - topHeight : 0;
  const destinations: { name: "gameplay" | "facecam" | "chat"; rect: NormalizedRect; dest: PixelRect }[] = [
    { name: "gameplay", rect: valid.gameplay, dest: { x: 0, y: mainY, w: output.w, h: topHeight } },
  ];
  optional.forEach((name, index) => {
    const x = optional.length === 2 ? index * even(output.w / 2) : 0;
    const w = optional.length === 2 ? (index === 0 ? x + even(output.w / 2) : output.w - x) : output.w;
    destinations.push({ name, rect: valid[name]!, dest: { x, y: smallBandY, w, h: output.h - topHeight } });
  });
  return { mode: "composed", output, panels: (facecamFirst ? destinations.slice(1).concat(destinations[0]) : destinations)
    .map(({ name, rect, dest }) => ({ name, source: cropToPanel(rect, source, dest), dest })),
    textSafe: { x: 0, y: mainY, w: output.w, h: topHeight } };
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
