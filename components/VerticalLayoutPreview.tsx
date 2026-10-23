"use client";

import { useEffect, useRef } from "react";
import { planVerticalLayout, type VerticalLayoutV1 } from "@/lib/vertical-layout";
import { buildCaptionCues, wrapCaptionText, type HookStyle } from "@/lib/captions";
import { drawHookPreview } from "@/lib/hook-preview";
import type { CaptionStyle, TimedWord } from "@/lib/clips";

export default function VerticalLayoutPreview({ video, layout, text }: { video: HTMLVideoElement | null; layout: VerticalLayoutV1 | null; text?: { hook: string; hookStyle: HookStyle; captionStyle: CaptionStyle; words: TimedWord[] | null; videoTrimStart: number; vodStart: number; vodEnd: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    let frame = 0;
    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (ctx && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const plan = planVerticalLayout({ w: video.videoWidth, h: video.videoHeight }, layout, { w: canvas.width, h: canvas.height });
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
        if (text) {
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
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [video, layout, text]);
  return <canvas ref={canvasRef} width={540} height={960} className="w-full max-w-[220px] h-auto rounded-lg border border-border bg-black" aria-label="Vertical clip preview" />;
}
