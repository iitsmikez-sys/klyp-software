import type { VerticalLayoutPlan } from "./vertical-layout.ts";

/** Build the video half of an export. Audio stays mapped from 0:a in the caller. */
export function buildVerticalFilterGraph(plan: VerticalLayoutPlan, overlays: string[]): { filter: string; videoLabel: string } {
  const filters: string[] = [];
  let current: string;
  if (plan.mode === "full_frame") {
    filters.push(`[0:v]scale=${plan.output.w}:${plan.output.h}:force_original_aspect_ratio=decrease,pad=${plan.output.w}:${plan.output.h}:(ow-iw)/2:(oh-ih)/2:color=0x101014,format=yuv420p[base]`);
    current = "base";
  } else {
    const n = plan.panels.length;
    filters.push(`[0:v]split=${n + 1}[bgsrc]${plan.panels.map((_, i) => `[s${i}]`).join("")}`);
    filters.push(`[bgsrc]scale=${plan.output.w}:${plan.output.h},drawbox=x=0:y=0:w=iw:h=ih:color=0x101014:t=fill[base]`);
    plan.panels.forEach((panel, i) => {
      const s = panel.source;
      const d = panel.dest;
      filters.push(`[s${i}]crop=${s.w}:${s.h}:${s.x}:${s.y},scale=${d.w}:${d.h}[p${i}]`);
    });
    current = "base";
    plan.panels.forEach((panel, i) => {
      const next = `mix${i}`;
      filters.push(`[${current}][p${i}]overlay=${panel.dest.x}:${panel.dest.y}:shortest=1[${next}]`);
      current = next;
    });
  }
  filters.push(`[${current}]${overlays.length ? overlays.join(",") + "," : ""}format=yuv420p,setsar=1[outv]`);
  return { filter: filters.join(";"), videoLabel: "outv" };
}
