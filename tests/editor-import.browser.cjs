// Mount the real editor with local generated footage. Only service/auth boundaries are faked.
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const ts=require('typescript'), {chromium}=require('playwright');
const evidence=path.resolve('.superpowers/sdd/2026-10-23-polished-editor-media-import');
fs.mkdirSync(evidence,{recursive:true});
const cssPath=path.join(evidence,'task-5-tailwind.css');
require('node:child_process').execFileSync(process.execPath,[require.resolve('tailwindcss/lib/cli.js'),'-i','app/globals.css','-o',cssPath],{windowsHide:true,stdio:'pipe'});
const sources={};
const excluded=new Set(['components/SparksProvider','components/NavigationGuardProvider','components/ProGateModal','lib/processing-api','lib/supabase/client']);
function load(file) {
 const key=file.replace(/\.tsx?$/,''); if(sources[key]||excluded.has(key))return;
 const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 sources[key]=compiled;
 for(const [,name] of compiled.matchAll(/require\("([^"]+)"\)/g)) {
  if(!name.startsWith('.')&&!name.startsWith('@/'))continue;
  if(name.endsWith('.css'))continue;
  const base=name.startsWith('@/')?name.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
  const actual=[base,base+'.ts',base+'.tsx'].find(f=>fs.existsSync(f));if(actual)load(actual);
 }
}
load('components/ClipTimelineEditor.tsx');
load('components/SavedClipEditorEntry.tsx');
load('components/ResultsClipPreviewModal.tsx');
const zodFile=path.relative(process.cwd(),require.resolve('zod')).replaceAll('\\','/');load(zodFile);sources.zod='Object.assign(exports,require(' + JSON.stringify('@/'+zodFile) + '));';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
 const page=await browser.newPage({viewport:{width:1672,height:941},hasTouch:true});page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
 await page.route('http://localhost:3139/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('http://localhost:3139/');
 await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/,'umd/react.development.js')});
 await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.development.js')});
 await page.addStyleTag({path:cssPath});await page.addStyleTag({path:'components/clip-timeline-editor.css'});await page.addStyleTag({path:'components/EditorWorkspace.module.css'});
 await page.evaluate(async sources=>{
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d');ctx.fillStyle='#00cc00';ctx.fillRect(0,0,160,90);
  const stream=canvas.captureStream(15),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
  recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();const redraw=setInterval(()=>ctx.fillRect(0,0,160,90),30);await new Promise(r=>setTimeout(r,3200));const stopped=new Promise(r=>recorder.onstop=r);recorder.stop();await stopped;clearInterval(redraw);stream.getTracks().forEach(t=>t.stop());
  window.sourceBlob=new Blob(chunks,{type:'video/webm'});window.saved=null;window.assets=[];window.uploadPhase='';window.failPreview=false;window.apiCalls=[];window.pro=true;
  window.clip={id:'clip',url:'upload:archived-source',title:'Import fixture',start_seconds:100,end_seconds:103,words:null,hook:''};
  window.fetch=async(url,init)=>{
   apiCalls.push(String(url));
   if(url==='/api/vertical-layout')return Response.json({layout:null});
   if(url==='/api/clip'){window.exported=JSON.parse(init.body);await new Promise(r=>window.releaseExport=r);return new Response(sourceBlob);}
   if(url==='/api/preview')return failPreview?Response.json({error:'Source archived and unavailable'}, {status:404}):new Response(sourceBlob);
   if(String(url).endsWith('/edit-draft')){window.saved=JSON.parse(init.body).draft;return Response.json({edit_draft:saved});}
   if(String(url).endsWith('/finalize')) {window.uploadPhase='verifying';await new Promise(r=>window.releaseVerify=r);const a=assets.at(-1);a.status='verified';return Response.json({asset:a});}
   if(url==='/api/clips/clip/media'&&init?.method==='POST') {window.uploadPhase='preparing';const m=JSON.parse(init.body),a={id:'asset-'+assets.length,clip_id:'clip',user_id:'fixture',storage_path:'private/'+assets.length,file_name:m.file_name,kind:m.mime_type.startsWith('image/')?'photo':'video',declared_mime:m.mime_type,declared_size:m.size_bytes,status:'pending',duration_ms:m.mime_type.startsWith('video/')?3000:null,width:160,height:90};assets.push(a);return Response.json({asset:a,upload:{path:a.storage_path,token:'signed',signedUrl:'not-used'}});}
   if(url==='/api/clips/clip/media'){if(!window.initialListStarted){window.initialListStarted=true;await new Promise(r=>window.releaseList=r);return Response.json({assets:[]});}return Response.json({assets});}
   const a=assets.find(a=>url==='/api/clips/clip/media/'+a.id);if(a)return window.failAsset?Response.json({error:'Imported file unavailable'},{status:503}):Response.json({asset:a,preview_url:a.url,expires_in:window.assetExpiry||300});
   if(String(url).startsWith('/api/editor-media?'))return Response.json({url:window.legacyPhoto});
   if(url==='/api/thumbnail')return new Response(sourceBlob);
   throw Error('Unexpected URL '+url);
  };
  const modules={react:React,'react/jsx-runtime':{Fragment:React.Fragment,jsx:(t,p,k)=>React.createElement(t,{...p,key:k}),jsxs:(t,p,k)=>React.createElement(t,{...p,key:k})},'next/navigation':{useRouter:()=>({push:()=>{}})},'components/SparksProvider':{useSparks:()=>({tier:pro?'pro':'free'})},'components/NavigationGuardProvider':{useUnsavedNavigationGuard:()=>{}},'components/ProGateModal':{default:()=>React.createElement('div',null,'Upgrade to Pro')},'lib/processing-api':{processingFetch:(...args)=>fetch(...args)},'lib/supabase/client':{createClient:()=>({storage:{from:bucket=>({uploadToSignedUrl:async(path,token,file,options)=>{if(bucket!=='editor-media'||token!=='signed'||options.contentType!==file.type)throw Error('Incorrect storage contract');window.uploadPhase='uploading';await new Promise(r=>window.releaseUpload=r);const a=assets.find(a=>a.storage_path===path);a.url=URL.createObjectURL(file);return {error:null};}})}})}};
  const normalize=p=>{const out=[];for(const part of p.split('/')){if(part==='..')out.pop();else if(part!=='.')out.push(part);}return out.join('/').replace(/\.tsx?$/,'');};
  const requireModule=(key)=>{if(modules[key])return modules[key];if(!sources[key])throw Error('Missing module '+key);const exports={};const module={exports};modules[key]=exports;new Function('require','exports','module',sources[key])(name=>name.endsWith('.css')?{default:new Proxy({},{get:(_,key)=>key})}:requireModule(name.startsWith('@/')?normalize(name.slice(2)):name.startsWith('.')?normalize(key.split('/').slice(0,-1).join('/')+'/'+name):name),exports,module);modules[key]=module.exports;return module.exports;};
  window.ResultsModal=requireModule('components/ResultsClipPreviewModal').default;window.Entry=requireModule('components/SavedClipEditorEntry').default;window.Editor=requireModule('components/ClipTimelineEditor').default;window.root=ReactDOM.createRoot(document.getElementById('root'));window.renderEditor=()=>root.render(React.createElement(Editor,{key:window.mountKey||0,clip:{...clip,edit_draft:saved}}));renderEditor();
 },sources);
 await page.waitForFunction(()=>document.querySelector('[aria-label="Source preview"] video')?.readyState>=2);
 if(process.env.EDITOR_CAPTURE){
  await page.screenshot({path:path.join(evidence,`task-5-${process.env.EDITOR_CAPTURE}-desktop.png`)});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,`task-5-${process.env.EDITOR_CAPTURE}-narrow.png`),fullPage:true});await page.setViewportSize({width:1672,height:941});
 }
 await page.getByRole('button',{name:'Add photo',exact:true}).waitFor();
 const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,160,90);return c.toDataURL().split(',')[1];});
 await page.getByLabel('Choose photo').setInputFiles({name:'red.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')});
 await page.getByText('Uploading file…',{exact:true}).waitFor();await page.evaluate(()=>releaseUpload());
 await page.getByText('Verifying media…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Insert red.png',exact:true}).count(),0);await page.evaluate(()=>releaseVerify());
 await page.getByRole('button',{name:'Insert red.png',exact:true}).waitFor();
 await page.evaluate(()=>releaseList());await page.getByText('Loading imported media…',{exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.getByRole('button',{name:'Insert red.png',exact:true}).count(),1,'A delayed initial media list must preserve a newly verified upload');
 await page.getByLabel('Playback volume').fill('0.35');
 assert.equal(await page.locator('[aria-label="Source preview"] video').evaluate(v=>v.volume),.35);
 await page.getByRole('button',{name:'Mute',exact:true}).click();assert.equal(await page.locator('[aria-label="Source preview"] video').evaluate(v=>v.muted),true);
 await page.getByRole('button',{name:'Unmute',exact:true}).click();assert.equal(await page.locator('[aria-label="Source preview"] video').evaluate(v=>v.muted),false);
 await page.getByLabel('Playhead position').fill('1.5');
 await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').first().click();await page.getByRole('button',{name:/Split/}).click();
 assert.equal(await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').count(),2);
 await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').first().click();await page.getByRole('button',{name:/Delete/}).click();
 assert.equal(await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').count(),1);
 await page.getByRole('button',{name:/Undo/}).click();await page.getByRole('button',{name:/Undo/}).click();
 await page.getByRole('button',{name:/Export clip/}).click();await page.getByRole('button',{name:'Exporting…',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Exporting…',exact:true}).isDisabled(),true);await page.evaluate(()=>releaseExport());await page.getByRole('button',{name:/Export clip/}).waitFor();
 await page.getByLabel('Playhead position').fill('0.5');
 await page.evaluate(()=>window.assetExpiry=31);await page.getByRole('button',{name:'Insert red.png',exact:true}).click();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas[aria-label="Vertical clip preview"]');if(!c)return false;const p=c.getContext('2d').getImageData(270,480,1,1).data;return p[0]>200&&p[1]<20;});
 await page.evaluate(()=>window.failAsset=true);await page.getByText('Imported file unavailable',{exact:false}).waitFor();
 await page.evaluate(()=>{window.failAsset=false;window.assetExpiry=300;});await page.getByRole('button',{name:'Retry imported media',exact:true}).click();
 await page.waitForFunction(()=>{const p=document.querySelector('canvas').getContext('2d').getImageData(270,480,1,1).data;return p[0]>200&&p[1]<20;});
 await page.getByLabel('Cutaway fit').selectOption('contain');await page.getByLabel('Cutaway vertical position').fill('1');
 await page.waitForFunction(()=>{const c=document.querySelector('canvas').getContext('2d');const top=c.getImageData(270,100,1,1).data,bottom=c.getImageData(270,900,1,1).data;return top[0]===0&&top[1]===0&&bottom[0]>200;});
 await page.getByLabel('Cutaway fit').selectOption('cover');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved to Klyp',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>saved.cutaways[0].source_start_ms),100500);
 await page.getByRole('button',{name:'Remove cutaway',exact:true}).click();
 assert.equal(await page.locator('[aria-label="Imported media lane"] button').count(),0);
 await page.getByRole('button',{name:/Undo/}).click();assert.equal(await page.locator('[aria-label="Imported media lane"] button').count(),1);
 await page.evaluate(()=>{window.mountKey=1;renderEditor();});await page.locator('[aria-label="Imported media lane"] button').waitFor();
 await page.getByLabel('Playhead position').fill('0');
 await page.waitForFunction(()=>{const p=document.querySelector('canvas').getContext('2d').getImageData(270,480,1,1).data;return p[1]>100&&p[0]<20;});
 await page.getByLabel('Playhead position').fill('1');await page.waitForFunction(()=>{const p=document.querySelector('canvas').getContext('2d').getImageData(270,480,1,1).data;return p[0]>200&&p[1]<20;});
 await page.locator('[aria-label="Imported media lane"] button').click();await page.getByRole('button',{name:'Remove cutaway',exact:true}).click();
 await page.getByRole('button',{name:'Media',exact:true}).click();
 const bytes=await page.evaluate(async()=>Array.from(new Uint8Array(await sourceBlob.arrayBuffer())));
 await page.getByLabel('Choose video').setInputFiles({name:'green.webm',mimeType:'video/webm',buffer:Buffer.from(bytes)});
 await page.getByText('Uploading file…',{exact:true}).waitFor();await page.evaluate(()=>releaseUpload());await page.getByText('Verifying media…',{exact:true}).waitFor();await page.evaluate(()=>releaseVerify());
 await page.getByLabel('Playhead position').fill('1');await page.getByRole('button',{name:'Insert green.webm',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="Imported video"]')?.readyState>=2);
 assert.equal(await page.getByLabel('Imported video',{exact:true}).evaluate(v=>v.muted),true);
 await page.getByLabel('Playhead position').fill('1.5');await page.waitForFunction(()=>Math.abs(document.querySelector('[aria-label="Imported video"]').currentTime-.5)<.08);
 await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(350);assert.ok(await page.getByLabel('Imported video',{exact:true}).evaluate(v=>v.currentTime)>.6);await page.getByRole('button',{name:'Pause',exact:true}).click();
 await page.evaluate(()=>{window.failPreview=true;window.mountKey=2;renderEditor();});await page.getByRole('button',{name:'Retry preview',exact:true}).waitFor();
 assert.ok((await page.getByRole('alert').allTextContents()).some(t=>t.includes('Source archived and unavailable')));
 await page.evaluate(()=>window.failPreview=false);await page.getByRole('button',{name:'Retry preview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="Source preview"] video')?.readyState>=2);
 assert.equal(await page.getByRole('button',{name:'Retry preview',exact:true}).count(),0);
 assert.ok(await page.evaluate(()=>apiCalls.includes('/api/preview')));
 assert.equal(await page.locator('[aria-label="Source preview"] video').evaluate(v=>v.muted),false);
 await page.evaluate(()=>{window.saved={...saved,segments:[{id:'trimmed',start_seconds:101,end_seconds:103}],start_seconds:101,cutaways:[{id:'offset-cut',asset_id:'asset-1',source_start_ms:100000,source_end_ms:103000,asset_in_ms:0,fit:'cover',focal_point:{x:.5,y:.5}}]};window.mountKey=3;renderEditor();});
 await page.locator('[aria-label="Imported media lane"] button').click();
 assert.equal(await page.getByLabel('Imported video start',{exact:true}).inputValue(),'1');
 // An encoded square frame with SAR 2:1 displays at 2:1. Coded asset metadata must not squash it.
 const {resolveBin}=await import('../lib/bin.ts');
 const sarBytes=require('node:child_process').execFileSync(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','color=lime:s=64x64:r=30:d=3,drawbox=x=32:y=0:w=32:h=64:color=blue:t=fill,setsar=2/1','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
 await page.evaluate(bytes=>{assets.push({...assets[1],id:'sar',width:64,height:64,url:URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'video/mp4'}))});window.saved={...saved,aspect_ratio:'1:1',segments:[{id:'whole',start_seconds:100,end_seconds:103}],start_seconds:100,cutaways:[{id:'sar-cut',asset_id:'sar',source_start_ms:100000,source_end_ms:103000,asset_in_ms:0,fit:'contain',focal_point:{x:.5,y:.5}}]};window.mountKey=4;renderEditor();},Array.from(sarBytes));
 await page.locator('[aria-label="Imported media lane"] button').click();
 await page.waitForFunction(()=>{const c=document.querySelector('canvas').getContext('2d');const top=c.getImageData(270,70,1,1).data,left=c.getImageData(100,270,1,1).data,right=c.getImageData(400,270,1,1).data;return top[0]===0&&top[1]===0&&top[2]===0&&left[1]>200&&right[2]>200;});
 assert.equal(await page.getByLabel('Imported video',{exact:true}).evaluate(v=>v.videoWidth/v.videoHeight),2);
 await page.getByLabel('Cutaway fit').selectOption('cover');await page.getByLabel('Cutaway horizontal position').fill('1');
 await page.waitForFunction(()=>{const c=document.querySelector('canvas').getContext('2d');return [[30,30],[510,30],[30,510],[510,510]].every(([x,y])=>c.getImageData(x,y,1,1).data[2]>200);});
 // A full-length photo must not strand its underlying source behind the overlay.
 await page.evaluate(()=>{window.saved={...saved,aspect_ratio:'9:16',cutaways:[{...saved.cutaways[0],id:'full-photo',asset_id:'asset-0',fit:'cover'}]};window.mountKey=4.5;renderEditor();});
 await page.locator('[aria-label="Imported media lane"] button').click();
 assert.equal(await page.getByRole('button',{name:/Split/}).isDisabled(),true);
 await page.getByText('Edit underlying source',{exact:true}).click();
 const sourceControls=page.getByLabel('Underlying source clips');
 await sourceControls.getByRole('button',{name:/Select source clip/}).tap();
 if(process.env.EDITOR_CAPTURE)await page.screenshot({path:path.join(evidence,'task-5-fix1-covered-source.png')});
 assert.equal(await page.getByRole('button',{name:/Split/}).isDisabled(),false);
 await page.getByLabel('Playhead position').fill('1.5');await page.getByRole('button',{name:/Split/}).click();
 assert.equal(await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').count(),2);
 await page.getByRole('button',{name:/Undo/}).click();
 const dragSourceHandle=async(name,delta)=>{const handle=sourceControls.getByRole('button',{name,exact:true}),box=await handle.boundingBox();assert.ok(box.width>=44&&box.height>=44);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+delta,box.y+box.height/2);await page.mouse.up();};
 await dragSourceHandle('Trim start of source clip 1',80);
 assert.ok(Number(await page.getByLabel('Playhead position').getAttribute('max'))<2.9,'Covered source start trims through a real pointer handle');
 await page.getByRole('button',{name:/Undo/}).click();
 await dragSourceHandle('Trim end of source clip 1',-80);
 assert.ok(Number(await page.getByLabel('Playhead position').getAttribute('max'))<2.9,'Covered source end trims through a real pointer handle');
 await page.getByRole('button',{name:/Undo/}).click();
 await page.getByText('Edit underlying source',{exact:true}).click();
 await page.locator('[aria-label="Imported media lane"] button').click();await page.getByRole('button',{name:'Remove cutaway',exact:true}).click();
 await page.evaluate(()=>{window.pro=false;window.saved=null;window.mountKey=5;renderEditor();});
 await page.getByRole('button',{name:'Media',exact:true}).click();await page.getByRole('button',{name:'Add photo',exact:true}).click();await page.getByText('Upgrade to Pro',{exact:true}).waitFor();assert.equal(await page.getByLabel('Choose photo').isDisabled(),true);
 await page.getByLabel('Export aspect ratio').selectOption('Original');
 await page.getByRole('button',{name:'Export original',exact:true}).click();await page.getByRole('button',{name:'Exporting…',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>exported.raw),true);assert.equal(await page.evaluate(()=>exported.clip_id),'owned');assert.equal(await page.evaluate(()=>'edit_draft' in exported),false);
 await page.evaluate(()=>releaseExport());await page.getByRole('button',{name:'Export original',exact:true}).waitFor();
 // A richer, explicitly synthetic local fixture exercises the final layout with real
 // decoded frames/audio. It is never shipped as user footage or used by production.
 const fixtureBytes=require('node:child_process').execFileSync(resolveBin('ffmpeg'),['-v','error','-f','lavfi','-i','testsrc2=size=360x640:rate=15:duration=18','-f','lavfi','-i','sine=frequency=220:sample_rate=44100:duration=18','-c:v','libx264','-preset','ultrafast','-crf','32','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{maxBuffer:16*1024*1024,windowsHide:true});
 await page.evaluate(bytes=>{window.pro=true;window.sourceBlob=new Blob([new Uint8Array(bytes)],{type:'video/mp4'});window.saved=null;window.clip={...clip,title:'Local editor test · synthetic footage',end_seconds:118,hook:'A MOMENT WORTH KEEPING',hooks:['A MOMENT WORTH KEEPING'],words:'Every great clip starts with a moment worth keeping. Find the moment in your transcript and make it yours. Add a photo while your stream audio keeps playing. Then save your edit and share.'.split(' ').map((text,i)=>({text,start:100000+i*480,end:100440+i*480}))};window.mountKey=6;renderEditor();},Array.from(fixtureBytes));
 await page.waitForFunction(()=>document.querySelector('[aria-label="Source preview"] video')?.readyState>=2);
 await page.getByRole('img',{name:'Source audio waveform'}).waitFor();
 await page.getByLabel('Playhead position').fill('4');await page.getByRole('button',{name:/Split/}).click();
 await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').last().click();await page.getByLabel('Playhead position').fill('10');await page.getByRole('button',{name:/Split/}).click();
 await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').last().click();await page.getByLabel('Playhead position').fill('14');await page.getByRole('button',{name:/Split/}).click();
 await page.getByRole('button',{name:'Media',exact:true}).click();await page.getByLabel('Playhead position').fill('7');await page.getByRole('button',{name:'Insert red.png',exact:true}).click();
 await page.getByRole('button',{name:'Transcript',exact:true}).click();
 const line=page.locator('.editor-transcript-lines button').nth(1);await line.click();assert.ok(Math.abs(Number(await page.getByLabel('Playhead position').inputValue())-3.84)<.02,'Transcript seeks its source moment');
 await page.locator('[aria-label="Video lane"] button[aria-label^="Select video"]').first().click();
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved to Klyp',{exact:true}).waitFor();
 const scroll=page.locator('.editor-track-scroll');assert.ok(await scroll.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Default zoom fits the whole edited clip');
 await page.getByLabel('Timeline zoom').fill('2');assert.ok(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth*1.9),'Zoom expands timed tracks');await page.getByLabel('Timeline zoom').fill('1');
 const ruler=await page.locator('.editor-ruler').boundingBox();await page.mouse.move(ruler.x+ruler.width*.2,ruler.y+12);await page.mouse.down();await page.mouse.move(ruler.x+ruler.width*.3,ruler.y+12);await page.mouse.up();assert.ok(Math.abs(Number(await page.getByLabel('Playhead position').inputValue())-5.4)<.1,'Ruler dragging seeks edited time');
 await page.getByRole('img',{name:'Source audio waveform'}).waitFor();await page.locator('.editor-video-frames img').first().waitFor();
 await page.waitForFunction(()=>Math.abs(document.querySelector('[aria-label="Source preview"] video').currentTime-5.4)<.1);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 if(process.env.EDITOR_CAPTURE){
  await page.screenshot({path:path.join(evidence,'task-5-polished-desktop.png')});
  await page.getByRole('button',{name:'Style',exact:true}).click();await page.screenshot({path:path.join(evidence,'task-5-polished-style.png')});
  await page.getByRole('button',{name:'Media',exact:true}).click();await page.screenshot({path:path.join(evidence,'task-5-polished-media.png')});
  await page.setViewportSize({width:390,height:844});
  for(const name of ['Save','Export clip'])assert.ok((await page.getByRole('button',{name,exact:true}).boundingBox()).height>=44,`${name} needs a 44px touch target`);
  assert.ok(await page.locator('.clip-editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Narrow editor must not overflow horizontally');
  await page.screenshot({path:path.join(evidence,'task-5-polished-narrow-player.png')});
  await page.locator('.editor-left-panel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'task-5-polished-narrow-media.png')});
  await page.getByLabel('Playhead position').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(evidence,'task-5-polished-narrow-timeline.png')});
  await page.setViewportSize({width:1672,height:941});
 }
 await page.evaluate(()=>{window.pro=false;window.mountKey=99;window.savedSnapshot=JSON.stringify(saved);renderEditor();});
 await page.getByRole('button',{name:'Export original',exact:true}).click();await page.getByRole('button',{name:'Exporting…',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>exported.raw),true);assert.equal(await page.evaluate(()=>exported.clip_id),'owned');assert.equal(await page.evaluate(()=>'edit_draft' in exported),false);assert.equal(await page.evaluate(()=>JSON.stringify(saved)===savedSnapshot),true);
 await page.evaluate(()=>releaseExport());await page.getByRole('button',{name:'Export original',exact:true}).waitFor();
 await page.evaluate(()=>{
  window.pro=false;const c=document.createElement('canvas');c.width=160;c.height=90;c.getContext('2d').fillRect(0,0,160,90);window.legacyPhoto=c.toDataURL();
  window.legacyDraft={segments:[{start:1,end:2},{start:7,end:9}],media:[{id:'11111111-1111-4111-8111-111111111111',kind:'image',after:0,duration:.5,name:'Saved photo'}],captionColor:'YELLOW',captionPosition:'CENTER',format:'Original'};
  localStorage.setItem('klyp-editor-'+clip.id,JSON.stringify(legacyDraft));root.render(React.createElement(Entry,{clip}));
 });
 await page.getByRole('region',{name:'Saved device edits'}).waitFor();await page.locator('.clip-editor').waitFor();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Open original editor',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 await page.getByRole('button',{name:'↑ Export',exact:true}).click();await page.waitForFunction(()=>exported?.legacy_editor===true);
 assert.deepEqual(await page.evaluate(()=>exported.segments),[{start:1,end:2},{start:7,end:9}]);assert.equal(await page.evaluate(()=>exported.media[0].id),'11111111-1111-4111-8111-111111111111');assert.equal(await page.evaluate(()=>exported.caption_color),'YELLOW');
 await page.evaluate(()=>releaseExport());await page.getByRole('button',{name:'↑ Export',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open timeline editor',exact:true}).click();await page.getByRole('button',{name:'Open original editor',exact:true}).waitFor();
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Open original editor',exact:true}).click();await page.getByRole('button',{name:'Open timeline editor',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('klyp-editor-'+clip.id)).segments),[{start:1,end:2},{start:7,end:9}]);
 await page.evaluate(()=>{
  window.resultSettings=null;window.keptResults=0;window.resultExportStates=[];window.closedResults=false;window.resultClip={...clip,id:''};
  window.resultsProps={clip:resultClip,initialDetailsOpen:true,draftId:'result-fixture',initialCaptionStyle:'CLEAN',initialSettings:{style:'CLEAN',hook:'RESULT HOOK',hook_style:'IMPACT',aspect_ratio:'Original',caption_color:'YELLOW',caption_position:'CENTER',segments:[{start:0,end:18}],media:[]},onClose:()=>window.closedResults=true,onCreateClip:()=>{},onDownloadClip:()=>{},onSettingsChange:settings=>window.resultSettings=settings,onKeepClip:()=>{window.keptResults++;window.resultClip={...resultClip,id:'kept-result'};root.render(React.createElement(ResultsModal,{...resultsProps,clip:resultClip}));},onExportStateChange:(working,error)=>window.resultExportStates.push({working,error})};
  root.render(React.createElement(ResultsModal,resultsProps));
 });
 await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Keep clip to add media',exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'Export format',exact:true}).inputValue(),'Original');
 await page.getByRole('button',{name:'Pink',exact:true}).click();await page.waitForFunction(()=>resultSettings?.caption_color==='PINK');
 assert.equal(await page.evaluate(()=>resultSettings.hook),'RESULT HOOK');assert.equal(await page.evaluate(()=>resultSettings.caption_position),'CENTER');
 await page.getByRole('button',{name:'Keep clip to add media',exact:true}).click();await page.getByRole('button',{name:'Keep clip to add media',exact:true}).waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>keptResults),1);
 await page.getByRole('button',{name:'↑ Export',exact:true}).click();await page.waitForFunction(()=>resultExportStates.some(s=>s.working));
 assert.equal(await page.evaluate(()=>exported.clip_id),'kept-result');assert.equal(await page.evaluate(()=>exported.caption_color),'PINK');
 await page.getByRole('button',{name:'Close preview',exact:true}).click();await page.waitForFunction(()=>closedResults);await page.evaluate(()=>releaseExport());await page.waitForFunction(()=>resultExportStates.some(s=>!s.working));
 assert.deepEqual(errors,[]);console.log('PASS mounted editor: photo/video picker, upload/probe stages, delayed media-list race, insertion, real canvas pixels, archived-source preview request, save/reload, remove/undo, muted video synchronization, volume/mute, source failure/retry, signed URL refresh/retry, fit/focal controls, trimmed media offsets, real SAR 2:1 MP4 geometry, Pro gate, split/delete/undo, export pending state, transcript seek, ruler drag, zoom, full-coverage photo source touch selection/split/pointer trims, responsive 44px header/screenshot checks, Free and downgrade original exports, and legacy device-draft restore/export/switch persistence, and new results customize/settings/keep/export callbacks.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

