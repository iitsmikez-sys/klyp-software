export const EDITOR_LAYOUT_MODES = ["FILL", "FIT", "FACECAM"] as const;
export type EditorLayoutMode = (typeof EDITOR_LAYOUT_MODES)[number];
export type FaceRegion = { x: number; y: number; w: number; h: number };
export type EditorLayout = { mode: EditorLayoutMode; x: number; y: number; face: FaceRegion };

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = {
  mode: "FILL", x: 0.5, y: 0.5,
  face: { x: 0.68, y: 0, w: 0.3, h: 0.35 },
};

export function parseEditorLayout(value: unknown): EditorLayout {
  if (value === undefined || value === null) return { ...DEFAULT_EDITOR_LAYOUT,
    face: { ...DEFAULT_EDITOR_LAYOUT.face } };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid video layout.");
  const item = value as Record<string, unknown>;
  const mode = item.mode;
  const face = (item.face ?? DEFAULT_EDITOR_LAYOUT.face) as Record<string, unknown> | null;
  if (!EDITOR_LAYOUT_MODES.includes(mode as EditorLayoutMode) ||
    typeof item.x !== "number" || !Number.isFinite(item.x) || item.x < 0 || item.x > 1 ||
    typeof item.y !== "number" || !Number.isFinite(item.y) || item.y < 0 || item.y > 1 ||
    !face || typeof face !== "object" ||
    !["x", "y", "w", "h"].every((key) => typeof face[key] === "number" && Number.isFinite(face[key]))) {
    throw new Error("Invalid video layout.");
  }
  const f = face as FaceRegion;
  if (f.x < 0 || f.y < 0 || f.w < 0.1 || f.h < 0.1 || f.x + f.w > 1 || f.y + f.h > 1) {
    throw new Error("Facecam region must stay inside the source video.");
  }
  return { mode: mode as EditorLayoutMode, x: item.x, y: item.y,
    face: { x: f.x, y: f.y, w: f.w, h: f.h } };
}

/** Filter graph for one trimmed source section, before timeline concatenation. */
export function sourceLayoutGraph(
  input: string, output: string, width: number, height: number,
  layout: EditorLayout, prefix: string,
): string {
  if (layout.mode === "FIT") return `${input}scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p${output}`;
  const fill = (w: number, h: number) => `scale=${w}:${h}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
    `crop=${w}:${h}:x=(iw-${w})*${layout.x}:y=(ih-${h})*${layout.y},setsar=1`;
  if (layout.mode === "FILL") return `${input}${fill(width, height)},format=yuv420p${output}`;
  const top = Math.round(height * 0.38 / 2) * 2;
  const bottom = height - top;
  const face = layout.face;
  return [
    `${input}split=2[${prefix}face][${prefix}game]`,
    `[${prefix}face]crop=iw*${face.w}:ih*${face.h}:iw*${face.x}:ih*${face.y},` +
      `scale=${width}:${top}:force_original_aspect_ratio=increase:force_divisible_by=2,` +
      `crop=${width}:${top},setsar=1[${prefix}top]`,
    `[${prefix}game]${fill(width, bottom)}[${prefix}bottom]`,
    `[${prefix}top][${prefix}bottom]vstack=inputs=2,format=yuv420p${output}`,
  ].join(";");
}

function cover(sourceW: number, sourceH: number, targetW: number, targetH: number, x: number, y: number) {
  const scale = Math.max(targetW / sourceW, targetH / sourceH);
  const cropW = targetW / scale, cropH = targetH / scale;
  return { sx: (sourceW - cropW) * x, sy: (sourceH - cropH) * y, sw: cropW, sh: cropH };
}

/** Draw the same fixed manual layout into the editor preview canvas. */
export function drawEditorLayoutPreview(
  ctx: CanvasRenderingContext2D, video: HTMLVideoElement,
  width: number, height: number, layout: EditorLayout,
): void {
  if (!video.videoWidth || !video.videoHeight) return;
  const sw = video.videoWidth, sh = video.videoHeight;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, width, height);
  if (layout.mode === "FIT") {
    const scale = Math.min(width / sw, height / sh);
    const w = sw * scale, h = sh * scale;
    ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
    return;
  }
  if (layout.mode === "FACECAM") {
    const top = Math.round(height * 0.38 / 2) * 2;
    const f = layout.face;
    const faceCrop = cover(sw * f.w, sh * f.h, width, top, 0.5, 0.5);
    ctx.drawImage(video, sw * f.x + faceCrop.sx, sh * f.y + faceCrop.sy,
      faceCrop.sw, faceCrop.sh, 0, 0, width, top);
    const gameCrop = cover(sw, sh, width, height - top, layout.x, layout.y);
    ctx.drawImage(video, gameCrop.sx, gameCrop.sy, gameCrop.sw, gameCrop.sh,
      0, top, width, height - top);
    return;
  }
  const crop = cover(sw, sh, width, height, layout.x, layout.y);
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
}
