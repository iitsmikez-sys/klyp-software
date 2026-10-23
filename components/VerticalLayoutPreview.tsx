"use client";

import { useEffect, useRef, useState } from "react";
import { planClipComposition, previewDimensions, type VerticalLayoutV1 } from "@/lib/vertical-layout";
import { buildCaptionCues, wrapCaptionText, layoutTimedCaption, type HookStyle } from "@/lib/captions";
import { drawHookPreview } from "@/lib/hook-preview";
import { captionAppearance, editorOverlayAtTime } from "@/lib/editor-captions";
import type { ClipEditDraftV2 } from "@/lib/clip-edit-draft";
import type { SavedClip } from "@/lib/clip-ui";
import type { CaptionStyle, TimedWord } from "@/lib/clips";

export default function VerticalLayoutPreview({ video, layout, text, editor, format = "9:16" }: { format?: "9:16" | "16:9" | "1:1" | "Original"; editor?: { draft: ClipEditDraftV2; clip: SavedClip; outputTime: () => number }; video: HTMLVideoElement | null; layout: VerticalLayoutV1 | null; text?: { hook: string; hookStyle: HookStyle; captionStyle: CaptionStyle; words: TimedWord[] | null; videoTrimStart: number; vodStart: number; vodEnd: number } }) {
  const [renderError, setRenderError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    let frame = 0;
    setRenderError(null);
    const draw = () => {
      try {
        const ctx = canvas.getContext("2d");
        if (ctx && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const source = { w: video.videoWidth, h: video.videoHeight };
          const dimensions = previewDimensions(source, format);
          if (canvas.height !== dimensions.h) canvas.height = dimensions.h;
          const plan = planClipComposition(source, format, layout, dimensions);
          ctx.fillStyle = "#101014";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (plan.mode === "full_frame") {
            const d = plan.dest;
            ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, d.x, d.y, d.w, d.h);
          } else {
            for (const panel of plan.panels) {
              const s = panel.source;
              const d = panel.dest;
              ctx.drawImage(video, s.x, s.y, s.w, s.h, d.x, d.y, d.w, d.h);
            }
          }
          if (editor) {
            const outputTime = editor.outputTime();
            const overlay = editorOverlayAtTime(editor.draft, editor.clip, outputTime);
            if (overlay.hook) drawHookPreview(ctx, outputTime, overlay.hook, editor.draft.hook_style, canvas.width, canvas.height);
            if (overlay.caption) {
              const appearance = captionAppearance(editor.draft);
              const safe = plan.mode === "composed" ? plan.textSafe : plan.dest;
              const style = editor.draft.caption_style;
              const caption = layoutTimedCaption(overlay.caption.text, style, appearance, { w: canvas.width, h: canvas.height }, safe);
              ctx.font = `${caption.bold ? "bold" : "normal"} ${caption.fontSize}px Arial`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.lineWidth = caption.outline * 2;
              ctx.strokeStyle = "black";
              ctx.fillStyle = appearance.color;
              for (const line of caption.lines) {
                ctx.strokeText(line.text, line.x, line.y);
                ctx.fillText(line.text, line.x, line.y);
              }
            }
            ctx.textBaseline = "alphabetic";
          } else if (text) {
            const clipTime = video.currentTime - text.videoTrimStart;
            if (text.hook && clipTime >= 0) drawHookPreview(ctx, clipTime, text.hook, text.hookStyle, canvas.width, canvas.height);
            if (text.words?.length) {
              const cues = buildCaptionCues(text.words, text.vodStart * 1000, text.vodEnd * 1000, text.captionStyle === "KLYP" ? 1 : 4);
              const active = cues.find((cue) => clipTime * 1000 >= cue.startMs && clipTime * 1000 < cue.endMs);
              if (active) {
                const safeBottom = plan.mode === "composed" ? plan.textSafe.h : plan.dest.y + plan.dest.h;
                ctx.font = `${text.captionStyle === "CLEAN" ? "normal 29" : "bold 41"}px Arial`;
                ctx.textAlign = "center";
                ctx.lineWidth = 5;
                ctx.strokeStyle = "black";
                ctx.fillStyle = text.captionStyle === "KLYP" ? "#00e5a0" : "white";
                const y = safeBottom - 40;
                const caption = text.captionStyle === "KLYP" ? active.text.toUpperCase() : active.text;
                const lines = wrapCaptionText(caption, text.captionStyle);
                lines.forEach((line, index) => {
                  const lineY = y - (lines.length - index - 1) * 48;
                  ctx.strokeText(line, canvas.width / 2, lineY);
                  ctx.fillText(line, canvas.width / 2, lineY);
                });
              }
            }
          }
        }
      } catch {
        setRenderError("Preview composition could not be rendered. Change the format or reload the clip to retry.");
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [video, layout, text, editor, format]);
  return <><canvas ref={canvasRef} width={540} height={format === "16:9" ? 304 : format === "1:1" ? 540 : 960} className="w-full max-w-[220px] h-auto rounded-lg border border-border bg-black" aria-label="Vertical clip preview" />{renderError && <p role="alert">{renderError}</p>}</>;
}
