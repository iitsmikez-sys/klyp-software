import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { captionAppearance, generateTimedCueAss, layoutTimedCaption } from "./captions.ts";

/** Pixel bands compare real browser canvas with libass, allowing font rasterization drift. */
test("rendered two-line CLEAN and BOLD captions match browser spacing and anchor", async () => {
 const browser = await chromium.launch({ channel: "chrome", headless: true });
 const dir = mkdtempSync(path.join(tmpdir(), "klyp-caption-parity-"));
 try {
  const page = await browser.newPage();
  for (const style of ["CLEAN", "BOLD"] as const) {
   for (const position of ["top", "center", "bottom"] as const) {
    const appearance = captionAppearance({ caption_color: "white", caption_position: position });
    const text = "MMMMMMMMMMMMMMMMMMMM MMMMMMMMMMMMMMMMMMMM";
    const layout = layoutTimedCaption(text, style, appearance, { w: 540, h: 960 });
    const canvasRows = await page.evaluate(layout => {
     const canvas = document.createElement("canvas"); canvas.width=540; canvas.height=960;
     const ctx=canvas.getContext("2d")!;
     ctx.font=`${layout.bold ? "bold" : "normal"} ${layout.fontSize}px Arial`;
     ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillStyle="white";
     for(const line of layout.lines) ctx.fillText(line.text,line.x,line.y);
     const data=ctx.getImageData(0,0,540,960).data;
     return Array.from({length:960},(_,y)=>Array.from({length:540},(_,x)=>data[(y*540+x)*4+3]).some(v=>v>150));
    }, layout);
    writeFileSync(path.join(dir,"caption.ass"),generateTimedCueAss([{start_ms:0,end_ms:1000,text}],style,appearance,{w:540,h:960}));
    const render=spawnSync("ffmpeg",["-v","error","-f","lavfi","-i","color=black:s=540x960:r=1:d=1","-vf","subtitles=caption.ass","-frames:v","1","-f","rawvideo","-pix_fmt","rgb24","-"],{cwd:dir,maxBuffer:2_000_000});
    assert.equal(render.status,0,render.stderr?.toString());
    const assRows=Array.from({length:960},(_,y)=>Array.from({length:540},(_,x)=>render.stdout[(y*540+x)*3]).some(v=>v>150));
    const bands=(rows:boolean[])=>rows.reduce<number[][]>((result,lit,y)=>{if(lit){if(!rows[y-1])result.push([]);result[result.length-1].push(y);}return result;},[]).map(b=>({center:(b[0]+b[b.length-1])/2,height:b.length}));
    const canvasBands=bands(canvasRows), assBands=bands(assRows);
    assert.equal(canvasBands.length,2,`${style} ${position} canvas lines`);
    assert.equal(assBands.length,2,`${style} ${position} ASS lines`);
    for(let i=0;i<2;i++) assert.ok(Math.abs(canvasBands[i].center-assBands[i].center)<=layout.fontSize*0.3,`${style} ${position} line ${i}: canvas ${canvasBands[i].center}, ASS ${assBands[i].center}`);
    assert.ok(Math.abs((assBands[1].center-assBands[0].center)-layout.lineHeight)<=2,`${style} ASS line spacing`);
    assert.ok(Math.abs((canvasBands[1].center-canvasBands[0].center)-layout.lineHeight)<=2,`${style} canvas line spacing`);
   }
  }
 } finally { await browser.close();rmSync(dir,{recursive:true,force:true}); }
});
