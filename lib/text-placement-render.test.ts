import assert from 'node:assert/strict';
import test from 'node:test';
import { captionAppearance, generateHookAss, generateTimedCueAss, hookTextLayout, layoutTimedCaption, wrapCaptionText } from './captions.ts';
import { drawHookPreview } from './hook-preview.ts';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const placement={x:.25,y:.8,scale:1.5};

test('resized caption uses the same absolute anchor and font size in canvas and ASS', () => {
  const appearance=captionAppearance({caption_color:'white',caption_position:'bottom',caption_placement:placement});
  const layout=layoutTimedCaption('A MOMENT','CLEAN',appearance,{w:1080,h:1920});
  assert.equal(layout.fontSize,87);
  assert.deepEqual(layout.lines.map(line=>[line.x,line.y]),[[270,1536]]);
  const ass=generateTimedCueAss([{start_ms:0,end_ms:1000,text:'A MOMENT'}],'CLEAN',appearance);
  assert.match(ass,/Style: Default,[^,]+,87,/);
  assert.match(ass,/\\pos\(270,1536\)/);
});

test('resized hook uses the selected center and size in canvas and ASS', () => {
  const ass=generateHookAss('A MOMENT',{w:1080,h:1920},'IMPACT',placement);
  assert.match(ass,/Style: Hook,[^,]+,117,/);
  assert.match(ass,/\\pos\(270,1536\)/);
  const points:number[][]=[];
  const ctx={save(){},restore(){},measureText:(text:string)=>({width:text.length*14}),strokeText(_text:string,x:number,y:number){points.push([x,y]);},fillText(_text:string,x:number,y:number){points.push([x,y]);}} as unknown as CanvasRenderingContext2D;
  drawHookPreview(ctx,0,'A MOMENT','IMPACT',1080,1920,placement);
  assert.ok(points.some(([x,y])=>x===270 && Math.abs(y-1536)<80));
});

test('moving a white box hook keeps its default line breaks', () => {
  const hook = 'THE FRONT IS THE RISKIEST PART TO CUT';
  const expected = wrapCaptionText(hook, 'BOLD', 18);
  const moved = hookTextLayout(hook, { w: 540, h: 960 }, 'WHITE_BOX', { x: .5, y: .3, scale: 1 });
  assert.deepEqual(moved.lines, expected);
  const ass = generateHookAss(hook, { w: 540, h: 960 }, 'WHITE_BOX', { x: .5, y: .3, scale: 1 });
  assert.ok(ass.includes(expected.join('\\N')));
});

test('large moved captions wrap and remain inside the export frame', () => {
  const appearance=captionAppearance({caption_color:'white',caption_position:'bottom',caption_placement:{x:.5,y:.925,scale:2.5}});
  const layout=layoutTimedCaption('Wait, is France in the EU?','BOLD',appearance,{w:540,h:960});
  assert.ok(layout.lines.length>1);
  for(const line of layout.lines){
    assert.ok(line.y-layout.fontSize/2-layout.outline>=0,`line starts at ${line.y}`);
    assert.ok(line.y+layout.fontSize/2+layout.outline<=960,`line ends at ${line.y}`);
  }
});

test('FFmpeg burns moved and resized hook and caption near their preview anchors',t=>{
  if(spawnSync('ffmpeg',['-version']).error){t.skip('FFmpeg unavailable');return;}
  const dir=mkdtempSync(path.join(tmpdir(),'klyp-text-placement-'));
  try{
    const appearance=captionAppearance({caption_color:'white',caption_position:'bottom',caption_placement:placement});
    const examples=[generateHookAss('A MOMENT',{w:540,h:960},'IMPACT',placement),generateTimedCueAss([{start_ms:0,end_ms:1000,text:'A MOMENT'}],'CLEAN',appearance,{w:540,h:960})];
    for(const [index,ass] of examples.entries()){
      writeFileSync(path.join(dir,'overlay.ass'),ass);
      const run=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=black:s=540x960:r=1:d=1','-vf','subtitles=overlay.ass','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{cwd:dir,maxBuffer:2_000_000});
      assert.equal(run.status,0,run.stderr?.toString());
      let count=0,sumX=0,sumY=0;
      for(let y=0;y<960;y++)for(let x=0;x<540;x++){
        const i=(y*540+x)*3;
        if(run.stdout[i]>150&&run.stdout[i+1]>150&&run.stdout[i+2]>150){count++;sumX+=x;sumY+=y;}
      }
      assert.ok(count>100,`overlay ${index} is visible`);
      assert.ok(Math.abs(sumX/count-135)<65,`overlay ${index} x=${sumX/count}`);
      assert.ok(Math.abs(sumY/count-768)<65,`overlay ${index} y=${sumY/count}`);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
