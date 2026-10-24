// Mounted regression checks. Run: node tests/editor-media.browser.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');
(async () => {
 const browser = await chromium.launch({headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const page = await browser.newPage();page.setDefaultTimeout(5000);page.on("pageerror",e=>console.error(e.message));
  await page.setContent('<style>.overflow-hidden{overflow:hidden}.flex{display:flex}.relative{position:relative}.w-3{width:12px}.shrink-0{flex-shrink:0}button{min-height:24px}</style><div id="root"></div>');
  await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/, 'umd/react.development.js')});
  await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/, 'umd/react-dom.development.js')});
  for (const file of ['lib/clip-trim.ts','lib/editor-timeline.ts','lib/editor-preview.ts','components/EditorMedia.tsx','components/EditorTimeline.tsx']) {
   const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
   await page.evaluate(({file,compiled})=>{
    window.modules ||= {'react':React,'react/jsx-runtime':{jsx:React.createElement,jsxs:React.createElement}};
    // JSX runtime passes a props object (including children), not variadic children.
    window.modules['react/jsx-runtime']={jsx:(type,props,key)=>React.createElement(type,{...props,key}),jsxs:(type,props,key)=>React.createElement(type,{...props,key})};
    window.requests ||= [];
    const exports={};new Function('require','exports',compiled)(name=>name==='@/lib/processing-api'?{processingFetch:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))}:window.modules[name],exports);
    const key=file.replace(/^lib\//,'@/lib/').replace(/\.tsx?$/,'');window.modules[key]=exports;
    if(file==='lib/clip-trim.ts')window.modules['./clip-trim.ts']=exports;
    if(file==='lib/editor-timeline.ts')window.modules['./editor-timeline.ts']=exports;
   },{file,compiled});
  }
  await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,80,40);
   const stream=canvas.captureStream(10), chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();const repaint=setInterval(()=>ctx.fillRect(0,0,80,40),50);await new Promise(r=>setTimeout(r,1300));const stopped=new Promise(r=>recorder.onstop=r);recorder.stop();await stopped;clearInterval(repaint);stream.getTracks().forEach(t=>t.stop());window.blob=new Blob(chunks,{type:'video/webm'});
   window.root=ReactDOM.createRoot(document.getElementById('root'));window.playing=false;window.feedClock=false;window.time=0;window.clipId='a';window.clipStart=100;window.segments=[{id:'s',start_seconds:100,end_seconds:101}];
   window.renderMedia=()=>root.render(React.createElement(modules['components/EditorMedia'].default,{clip:{id:clipId,url:'upload:test',start_seconds:window.clipStart,end_seconds:101},segments,outputTime:time,playing:window.playing,onTimeChange:value=>{if(window.feedClock){window.time=value;renderMedia();}},onPlayingChange:value=>{window.playing=value;}}));renderMedia();
  });
  await page.waitForFunction(()=>requests.length===1);
  await page.evaluate(()=>{window.time=.6;renderMedia();});
  await page.waitForTimeout(60);
  await page.evaluate(()=>{window.clipId='b';renderMedia();});
  await page.waitForFunction(()=>requests.length===2);
  await page.evaluate(()=>requests[1].resolve(new Response(blob)));
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await page.waitForTimeout(100);
  const results=[];
  const check=async(name,fn)=>{try{await fn();results.push({name,pass:true});}catch(e){results.push({name,pass:false,error:e.message});}};
  await check('pending output seek survives loading',async()=>assert.ok(Math.abs(await page.locator('video').evaluate(v=>v.currentTime)-.6)<.025));
  await page.evaluate(()=>requests[0].reject(new DOMException('obsolete request','AbortError')));
  await page.waitForTimeout(80);
  await check('obsolete AbortError does not cover replacement media',async()=>assert.equal(await page.getByRole('alert').count(),0));
  await page.evaluate(()=>{window.time=.59;renderMedia();});await page.waitForTimeout(80);await page.evaluate(()=>{window.time=.6;renderMedia();});await page.waitForTimeout(80);
  await check('10ms controlled seek applies',async()=>assert.ok(Math.abs(await page.locator('video').evaluate(v=>v.currentTime)-.6)<.005));
  await check('controlled playback clock does not repeatedly seek',async()=>{
   await page.evaluate(()=>{window.time=.05;renderMedia();});await page.waitForTimeout(100);
   await page.evaluate(()=>{window.seekCount=0;document.querySelector('video').addEventListener('seeking',()=>window.seekCount++);window.feedClock=true;window.playing=true;renderMedia();});
   await page.waitForTimeout(350);
   const playback=await page.evaluate(()=>{const result={seeks:window.seekCount,time:document.querySelector('video').currentTime};window.playing=false;window.feedClock=false;renderMedia();return result;});
   console.log('Controlled playback:',JSON.stringify(playback));assert.ok(playback.seeks<=2,`Playback published clock caused ${playback.seeks} seeks`);assert.ok(playback.time>.25,'Playback must advance while feeding back clock');
  });
  await check('fractional archive preview seeks from floored master start',async()=>{
   await page.evaluate(()=>{window.clipId='fractional';window.clipStart=100.25;window.time=.1;window.segments=[{id:'s',start_seconds:100.5,end_seconds:101}];renderMedia();});
   await page.waitForFunction(()=>requests.length===3);
   await page.evaluate(()=>requests[2].resolve(new Response(blob,{headers:{'X-Klyp-Source':'archive'}})));
   await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await page.waitForTimeout(100);
   assert.ok(Math.abs(await page.locator('video').evaluate(v=>v.currentTime)-.6)<.025);
  });
  await page.evaluate(()=>{
   window.trims=[];window.selected=null;
   root.render(React.createElement(modules['components/EditorTimeline'].default,{segments:[{id:'short',start_seconds:100,end_seconds:100.1}],sourceStart:99,sourceEnd:101,captions:[],hook:'',outputTime:0,thumbnails:[],peaks:null,selection:null,onSelect:s=>window.selected=s,onSeek:()=>{},onTrim:(...args)=>trims.push(args)}));
  });await page.waitForTimeout(80);
  await check('short segment selection remains reachable',async()=>{await page.getByRole('button',{name:'Select short segment short',exact:true}).click({timeout:1500});assert.equal(await page.evaluate(()=>selected?.id),'short');});
  await check('short segment trim remains reachable and keyboard usable',async()=>{const handle=page.getByRole('button',{name:'Trim end of short segment short',exact:true});await handle.focus({timeout:1500});await page.keyboard.press('ArrowRight');assert.ok((await page.evaluate(()=>trims.at(-1)?.[2]))>100.1);});
  await check('cancelled pointer does not commit a later release',async()=>{const handle=page.getByRole('button',{name:'Trim end of short segment short',exact:true});await handle.evaluate(el=>{el.setPointerCapture=()=>{};el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,clientX:0}));el.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:2}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2,clientX:20}));});assert.equal(await page.evaluate(()=>trims.length),1);});
  await check('lost capture cancels pending trim',async()=>{const handle=page.getByRole('button',{name:'Trim end of short segment short',exact:true});await handle.evaluate(el=>{el.setPointerCapture=()=>{};el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:3,clientX:0}));el.dispatchEvent(new PointerEvent('lostpointercapture',{bubbles:true,pointerId:3}));el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3,clientX:20}));});assert.equal(await page.evaluate(()=>trims.length),1);});
  await check('normal trim release commits once',async()=>{const handle=page.getByRole('button',{name:'Trim end of short segment short',exact:true});const box=await handle.boundingBox();assert.ok(box.width>=44 && box.height>=44);await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+30,box.y+20);await page.mouse.up();assert.equal(await page.evaluate(()=>trims.length),2);});
  console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>r.pass),'Mounted regression checks failed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
