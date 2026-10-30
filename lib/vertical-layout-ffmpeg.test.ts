import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planVerticalLayout } from "./vertical-layout.ts";
import { buildVerticalFilterGraph, buildTimedVerticalFilterGraph } from "./vertical-layout-ffmpeg.ts";

const source = { w: 1920, h: 1080 };
const output = { w: 1080, h: 1920 };
const gameplay = { x: 0.2, y: 0, w: 0.6, h: 1 };

test("full-frame fallback keeps uncropped source over a filled background", () => {
  const result = buildVerticalFilterGraph(planVerticalLayout(source, null, output), []);
  assert.match(result.filter, /scale=1080:1920:force_original_aspect_ratio=decrease/);
  assert.match(result.filter, /boxblur=8:1:3:1/);
  assert.equal(result.videoLabel, "outv");
});

test("foreground zoom uses the same pixel geometry as preview", () => {
  const plan = planVerticalLayout(source, { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 }, foreground: { scale: 2, x: .25, y: .75 } }, output);
  const graph = buildVerticalFilterGraph(plan, []);
  assert.match(graph.filter, /scale=2160:1216/);
  assert.match(graph.filter, /overlay=-270:528:shortest=1/);
});

test("FFmpeg renders enlarged foreground in the selected vertical position", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).error) { t.skip("FFmpeg is unavailable"); return; }
  const plan = planVerticalLayout({ w: 320, h: 180 }, { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 }, foreground: { scale: 2, x: .5, y: .5 } }, { w: 90, h: 160 });
  const graph = buildVerticalFilterGraph(plan, []);
  const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=1:d=1,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill", "-filter_complex", graph.filter, "-map", `[${graph.videoLabel}]`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 100000 });
  assert.equal(run.status, 0, run.stderr?.toString());
  const pixel = (x: number, y: number) => Array.from(run.stdout.subarray((y * 90 + x) * 3, (y * 90 + x) * 3 + 3));
  const left = pixel(5, 80), right = pixel(85, 80);
  assert.ok(left[0] > 100 && left[2] < 100, `left ${left}`);
  assert.ok(right[2] > 100 && right[0] < 100, `right ${right}`);
});

test("saved full-stream fit uses the same pixel placement in export", () => {
  const plan = planVerticalLayout({ w: 320, h: 180 }, { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 }, fit: { zoom: 1.5, x: .1, y: -.1 } }, { w: 90, h: 160 });
  assert.equal(plan.mode, "full_frame");
  if (plan.mode !== "full_frame") return;
  const graph = buildVerticalFilterGraph(plan, []);
  assert.match(graph.filter, new RegExp(`scale=${plan.dest.w}:${plan.dest.h}`));
  assert.match(graph.filter, new RegExp(`overlay=${plan.dest.x}:${plan.dest.y}`));
});

test("composed graph crops gameplay, facecam and chat then fills vertical output", () => {
  const plan = planVerticalLayout(source, { version: 1, gameplay, facecam: { x: 0, y: 0.6, w: 0.2, h: 0.3 }, chat: { x: 0.8, y: 0.1, w: 0.2, h: 0.7 } }, output);
  const result = buildVerticalFilterGraph(plan, []);
  assert.match(result.filter, /split=4/);
  assert.match(result.filter, /overlay=540:1344/);
  assert.match(result.filter, /scale=1080:1344/);
  assert.equal(result.filter.endsWith("[outv]"), true);
});

test("text overlays are appended after composition", () => {
  const plan = planVerticalLayout(source, { version: 1, gameplay }, output);
  const result = buildVerticalFilterGraph(plan, ["drawtext=text='KLYP'"]);
  assert.match(result.filter, /\[mix0\]drawtext=text='KLYP',format=yuv420p,setsar=1\[outv\]$/);
});

test("FFmpeg renders gameplay, facecam and chat in their preview panels", (t) => {
  const check = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (check.error) { t.skip("FFmpeg is unavailable"); return; }
  const layout = { version: 1 as const, gameplay: { x: 0.2, y: 0, w: 0.6, h: 1 }, facecam: { x: 0, y: 0.6, w: 0.2, h: 0.4 }, chat: { x: 0.8, y: 0, w: 0.2, h: 1 } };
  const graph = buildVerticalFilterGraph(planVerticalLayout({ w: 320, h: 180 }, layout, { w: 90, h: 160 }), []);
  const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=1:d=1,drawbox=x=0:y=108:w=64:h=72:color=blue:t=fill,drawbox=x=256:y=0:w=64:h=180:color=yellow:t=fill", "-filter_complex", graph.filter, "-map", `[${graph.videoLabel}]`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 2_000_000 });
  assert.equal(run.status, 0, run.stderr?.toString());
  const pixel = (x: number, y: number) => Array.from(run.stdout.subarray((y * 90 + x) * 3, (y * 90 + x) * 3 + 3));
  const top = pixel(45, 40), left = pixel(20, 140), right = pixel(70, 140);
  assert.ok(top[0] > 150 && top[1] < 80 && top[2] < 80, `gameplay ${top}`);
  assert.ok(left[2] > 100 && left[0] < 80, `facecam ${left}`);
  assert.ok(right[0] > 140 && right[1] > 140 && right[2] < 80, `chat ${right}`);
});

test("FFmpeg renders facecam above gameplay when the clip uses facecam-first", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).error) { t.skip("FFmpeg is unavailable"); return; }
  const layout = { version: 1 as const, gameplay: { x: 0.3, y: 0, w: 0.7, h: 1 }, facecam: { x: 0, y: 0, w: 0.25, h: 1 }, arrangement: "facecam_top" as const };
  const graph = buildVerticalFilterGraph(planVerticalLayout({ w: 320, h: 180 }, layout, { w: 90, h: 160 }), []);
  const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=1:d=1,drawbox=x=0:y=0:w=80:h=180:color=blue:t=fill", "-filter_complex", graph.filter, "-map", `[${graph.videoLabel}]`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 2_000_000 });
  assert.equal(run.status, 0, run.stderr?.toString());
  const pixel = (x: number, y: number) => Array.from(run.stdout.subarray((y * 90 + x) * 3, (y * 90 + x) * 3 + 3));
  const top = pixel(45, 20), bottom = pixel(45, 120);
  assert.ok(top[2] > 100 && top[0] < 80, `facecam ${top}`);
  assert.ok(bottom[0] > 150 && bottom[2] < 80, `gameplay ${bottom}`);
});

test("vertical export preserves an audio stream", (t) => {
  if (spawnSync("ffmpeg", ["-version"]).error) { t.skip("FFmpeg is unavailable"); return; }
  const dir = mkdtempSync(path.join(tmpdir(), "klyp-layout-test-"));
  try {
    const outputPath = path.join(dir, "clip.mp4");
    const graph = buildVerticalFilterGraph(planVerticalLayout({ w: 320, h: 180 }, null, { w: 90, h: 160 }), []);
    const run = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=10:d=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-filter_complex", graph.filter, "-map", `[${graph.videoLabel}]`, "-map", "1:a", "-c:v", "libx264", "-c:a", "aac", "-t", "1", "-y", outputPath], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.ok(readFileSync(outputPath).byteLength > 0);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,sample_aspect_ratio,display_aspect_ratio", "-of", "json", outputPath], { encoding: "utf8" });
    assert.equal(probe.status, 0, probe.stderr);
    const streams = JSON.parse(probe.stdout).streams as { codec_type: string; width?: number; height?: number; sample_aspect_ratio?: string; display_aspect_ratio?: string }[];
    const picture = streams.find((stream) => stream.codec_type === "video");
    assert.equal(picture?.width, 90);
    assert.equal(picture?.height, 160);
    assert.equal(picture?.sample_aspect_ratio, "1:1");
    assert.equal(picture?.display_aspect_ratio, "9:16");
    assert.ok(streams.some((stream) => stream.codec_type === "audio"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reaction focus makes facecam large on top and gameplay small below', () => {
 const layout = {version:1 as const,gameplay:{x:.25,y:0,w:.75,h:1},facecam:{x:0,y:0,w:.25,h:1},focus:'reaction' as const};
 const plan = planVerticalLayout({w:320,h:180},layout,{w:90,h:160});
 assert.equal(plan.mode,'composed');
 if(plan.mode==='composed') assert.deepEqual(plan.panels.map(p=>[p.name,p.dest.y,p.dest.h]),[['facecam',0,112],['gameplay',112,48]]);
});

test('timed export switches gameplay and reaction focus while retaining audio', (t) => {
 if(spawnSync('ffmpeg',['-version']).error){t.skip('FFmpeg unavailable');return;}
 const dir=mkdtempSync(path.join(tmpdir(),'klyp-focus-'));
 try {
  const base={version:1 as const,gameplay:{x:.25,y:0,w:.75,h:1},facecam:{x:0,y:0,w:.25,h:1},arrangement:'gameplay_top' as const};
  const reaction={...base,arrangement:'facecam_top' as const,focus:'reaction' as const};
  const graph=buildTimedVerticalFilterGraph([
   {start_ms:0,end_ms:1000,plan:planVerticalLayout({w:320,h:180},base,{w:90,h:160})},
   {start_ms:1000,end_ms:2000,plan:planVerticalLayout({w:320,h:180},reaction,{w:90,h:160})},
  ],[]);
  const file=path.join(dir,'focus.mp4');
  const encode=spawnSync('ffmpeg',['-loglevel','error','-f','lavfi','-i','color=c=red:s=320x180:r=10:d=2,drawbox=x=0:y=0:w=80:h=180:color=blue:t=fill','-f','lavfi','-i','sine=frequency=440:duration=2','-filter_complex',graph.filter,'-map',`[${graph.videoLabel}]`,'-map','1:a','-c:v','libx264','-c:a','aac','-y',file],{encoding:'utf8'});
  assert.equal(encode.status,0,encode.stderr);
  const frame=(second:number)=>spawnSync('ffmpeg',['-loglevel','error','-ss',String(second),'-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:100000});
  const first=frame(.5),later=frame(1.5);
  assert.equal(first.status,0,first.stderr?.toString());assert.equal(later.status,0,later.stderr?.toString());
  const pixel=(buffer:Buffer,x:number,y:number)=>Array.from(buffer.subarray((y*90+x)*3,(y*90+x)*3+3));
  const earlyTop=pixel(first.stdout,45,20),lateTop=pixel(later.stdout,45,20);
  assert.ok(earlyTop[0]>100&&earlyTop[2]<100,`early gameplay ${earlyTop}`);
  assert.ok(lateTop[2]>100&&lateTop[0]<100,`late facecam ${lateTop}`);
  const probe=spawnSync('ffprobe',['-v','error','-show_entries','stream=codec_type','-of','json',file],{encoding:'utf8'});
  assert.ok(JSON.parse(probe.stdout).streams.some((s:{codec_type:string})=>s.codec_type==='audio'));
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('default vertical export fills the side bands while retaining complete source in foreground', (t) => {
  if (spawnSync('ffmpeg', ['-version']).error) { t.skip('FFmpeg unavailable'); return; }
  const plan = planVerticalLayout({ w: 320, h: 180 }, null, { w: 90, h: 160 });
  const graph = buildVerticalFilterGraph(plan, []);
  assert.match(graph.filter, /boxblur=/);
  const run = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i',
    'color=c=red:s=320x180:r=1:d=1,drawbox=x=0:y=0:w=60:h=180:color=blue:t=fill',
    '-filter_complex', graph.filter, '-map', `[${graph.videoLabel}]`, '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 2_000_000 });
  assert.equal(run.status, 0, run.stderr?.toString());
  const pixel = (x: number, y: number) => Array.from(run.stdout.subarray((y * 90 + x) * 3, (y * 90 + x) * 3 + 3));
  const top = pixel(45, 10), bottom = pixel(45, 150), facecam = pixel(10, 80);
  assert.ok(top[0] > 90, `top has source-derived color: ${top}`);
  assert.ok(bottom[0] > 90, `bottom has source-derived color: ${bottom}`);
  assert.ok(facecam[2] > 100, `foreground retains the left source edge: ${facecam}`);
});
