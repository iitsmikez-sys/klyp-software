import type { VerticalLayoutPlan } from "./vertical-layout.ts";

type Graph = { filter: string; videoLabel: string };

function composePlan(plan: VerticalLayoutPlan, inputLabel: string, prefix: string, overlays: readonly string[]): Graph {
  const filters: string[] = [];
  const label = (name: string) => `${prefix}${name}`;
  let current: string;
  if (plan.mode === "full_frame") {
    const d = plan.dest;
    if (d.x === Math.round((plan.output.w - d.w) / 2) && d.y === Math.round((plan.output.h - d.h) / 2) && d.w <= plan.output.w && d.h <= plan.output.h) {
      filters.push(`[${inputLabel}]scale=${plan.output.w}:${plan.output.h}:force_original_aspect_ratio=decrease,pad=${plan.output.w}:${plan.output.h}:(ow-iw)/2:(oh-ih)/2:color=0x101014,format=yuv420p[${label('base')}]`);
      current = label('base');
    } else {
      filters.push(`[${inputLabel}]split=2[${label('bgsrc')}][${label('frame')}]`);
      filters.push(`[${label('bgsrc')}]scale=${plan.output.w}:${plan.output.h},drawbox=x=0:y=0:w=iw:h=ih:color=0x101014:t=fill[${label('base')}]`);
      filters.push(`[${label('frame')}]scale=${d.w}:${d.h}[${label('scaled')}]`);
      filters.push(`[${label('base')}][${label('scaled')}]overlay=${d.x}:${d.y}:shortest=1[${label('placed')}]`);
      current = label('placed');
    }
  } else {
    const n = plan.panels.length;
    filters.push(`[${inputLabel}]split=${n + 1}[${label('bgsrc')}]${plan.panels.map((_, i) => `[${label(`s${i}`)}]`).join('')}`);
    filters.push(`[${label('bgsrc')}]scale=${plan.output.w}:${plan.output.h},drawbox=x=0:y=0:w=iw:h=ih:color=0x101014:t=fill[${label('base')}]`);
    plan.panels.forEach((panel, i) => {
      const s = panel.source, d = panel.dest;
      filters.push(`[${label(`s${i}`)}]crop=${s.w}:${s.h}:${s.x}:${s.y},scale=${d.w}:${d.h}[${label(`p${i}`)}]`);
    });
    current = label('base');
    plan.panels.forEach((panel, i) => {
      const next = label(`mix${i}`);
      filters.push(`[${current}][${label(`p${i}`)}]overlay=${panel.dest.x}:${panel.dest.y}:shortest=1[${next}]`);
      current = next;
    });
  }
  const videoLabel = label('outv');
  filters.push(`[${current}]${overlays.length ? overlays.join(',') + ',' : ''}format=yuv420p,setsar=1[${videoLabel}]`);
  return { filter: filters.join(';'), videoLabel };
}

/** Build the video half of an export. Audio stays mapped from 0:a in the caller. */
export function buildVerticalFilterGraph(plan: VerticalLayoutPlan, overlays: string[]): Graph {
  return composePlan(plan, '0:v', '', overlays);
}

/** Compose source-anchored focus intervals after kept segments become a continuous clip. */
export function buildTimedVerticalFilterGraph(spans: readonly { start_ms: number; end_ms: number; plan: VerticalLayoutPlan }[], overlays: string[]): Graph {
  if (!spans.length || spans.length > 13 || spans[0].start_ms !== 0 ||
      spans.some((span, i) => !Number.isFinite(span.start_ms) || !Number.isFinite(span.end_ms) || span.end_ms <= span.start_ms || (i > 0 && span.start_ms !== spans[i - 1].end_ms))) {
    throw new Error('Invalid focus composition spans.');
  }
  const filters: string[] = [];
  if (spans.length > 1) filters.push(`[0:v]split=${spans.length}${spans.map((_, i) => `[chunk${i}]`).join('')}`);
  const labels = spans.map((span, i) => {
    const from = spans.length > 1 ? `chunk${i}` : '0:v';
    filters.push(`[${from}]trim=start=${span.start_ms / 1000}:end=${span.end_ms / 1000},setpts=PTS-STARTPTS[in${i}]`);
    const graph = composePlan(span.plan, `in${i}`, `focus${i}_`, []);
    filters.push(graph.filter);
    return graph.videoLabel;
  });
  if (labels.length > 1) filters.push(`${labels.map(label => `[${label}]`).join('')}concat=n=${labels.length}:v=1:a=0[joined]`);
  const current = labels.length > 1 ? 'joined' : labels[0];
  filters.push(`[${current}]${overlays.length ? overlays.join(',') + ',' : ''}format=yuv420p,setsar=1[outv]`);
  return { filter: filters.join(';'), videoLabel: 'outv' };
}
