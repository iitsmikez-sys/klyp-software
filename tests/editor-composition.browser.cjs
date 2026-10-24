// Real decoded landscape fixture versus the actual mounted preview and FFmpeg composition.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),ts=require('typescript');
const {spawnSync}=require('child_process');const {chromium}=require('playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'klyp-composition-'));
const ff=args=>{const r=spawnSync('ffmpeg',['-v','error',...args],{maxBuffer:8e6,windowsHide:true});assert.equal(r.status,0,r.stderr?.toString());return r.stdout;};
(async()=>{let browser;try{
 const fixture=path.join(dir,'landscape.mp4');ff(['-f','lavfi','-i','testsrc2=s=1920x800:r=1:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',fixture]);
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<video muted></video><div id="root" class="editor-canvas"></div>');
 await page.addStyleTag({content:fs.readFileSync('components/clip-timeline-editor.css','utf8')});
 await page.addScriptTag({path:require.resolve('react').replace(/index\.js$/,'umd/react.development.js')});await page.addScriptTag({path:require.resolve('react-dom').replace(/index\.js$/,'umd/react-dom.development.js')});
 const files=['lib/captions.ts','lib/vertical-layout.ts','lib/editor-timeline.ts','lib/editor-captions.ts','lib/hook-preview.ts','components/VerticalLayoutPreview.tsx','components/EditorInspector.tsx'];
 const sources={};
 for(const f of files)sources[f.replace(/\.tsx?$/,'')]=ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 await page.evaluate(({sources,captionStyles})=>{const cache={'lib/clips':{CAPTION_STYLES:captionStyles},'react':React,'react/jsx-runtime':{Fragment:React.Fragment,jsx:(t,p,k)=>React.createElement(t,{...p,key:k}),jsxs:(t,p,k)=>React.createElement(t,{...p,key:k})}};window.load=(id)=>{if(cache[id])return cache[id];const exports={};cache[id]=exports;new Function('require','exports',sources[id])(name=>load(name.startsWith('@/')?name.slice(2):name.startsWith('./')?'lib/'+name.slice(2).replace(/\.ts$/,''):name),exports);return exports;};window.root=ReactDOM.createRoot(document.getElementById('root'));window.renderPreview=(format,layout=null)=>root.render(React.createElement(load('components/VerticalLayoutPreview').default,{video:document.querySelector('video'),format,layout}));},{sources,captionStyles:require('../lib/clips.ts').CAPTION_STYLES});
 await page.locator('video').evaluate((v,data)=>{v.src='data:video/mp4;base64,'+data;},fs.readFileSync(fixture).toString('base64'));await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
 await page.evaluate(()=>renderPreview('1:1'));await page.waitForTimeout(150);
 const canvas=await page.locator('canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 // Compare central samples away from color boundaries, including top/bottom bands.
 const expected=ff(['-i',fixture,'-vf','scale=540:540:force_original_aspect_ratio=increase,crop=540:540','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
 const compare=(pixels,label)=>{let sum=0,n=0;for(let y=15;y<525;y+=30)for(let x=15;x<525;x+=30)for(let c=0;c<3;c++){sum+=Math.abs(canvas[(y*540+x)*4+c]-pixels[(y*540+x)*3+c]);n++;}console.log(label, sum/n);assert.ok(sum/n<12,label+' mean color error '+sum/n);};
 compare(expected,'Square independent center crop');
 const {planClipComposition}=require('../lib/vertical-layout.ts');const {buildVerticalFilterGraph}=require('../lib/vertical-layout-ffmpeg.ts');
 const graph=buildVerticalFilterGraph(planClipComposition({w:1920,h:800},'1:1',null,{w:1080,h:1080}),[]);
 const exported=ff(['-i',fixture,'-filter_complex',graph.filter+';[outv]scale=540:540[comparison]','-map','[comparison]','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
 compare(exported,'Square actual export filter');
 await page.evaluate(()=>renderPreview('16:9'));await page.waitForTimeout(100);
 const wideCanvas=await page.locator('canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 const wideGraph=buildVerticalFilterGraph(planClipComposition({w:1920,h:800},'16:9',null,{w:1920,h:1080}),[]);
 const wideExport=ff(['-i',fixture,'-filter_complex',wideGraph.filter+';[outv]scale=540:304[comparison]','-map','[comparison]','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
 let wideError=0,wideSamples=0;for(let y=15;y<290;y+=30)for(let x=15;x<525;x+=30)for(let c=0;c<3;c++){wideError+=Math.abs(wideCanvas[(y*540+x)*4+c]-wideExport[(y*540+x)*3+c]);wideSamples++;}console.log('16:9 actual export filter',wideError/wideSamples);assert.ok(wideError/wideSamples<12);

 await page.evaluate(()=>renderPreview('Original'));await page.waitForTimeout(100);assert.equal(await page.locator('canvas').evaluate(c=>c.height%2),0);assert.deepEqual(errors,[]);
 await page.evaluate(()=>renderPreview('9:16',{version:1,gameplay:{x:0,y:0,w:0,h:0}}));await page.getByRole('alert').waitFor();const alertBox=await page.getByRole('alert').boundingBox();assert.ok(alertBox.width>100&&alertBox.height>100,'Render failure must be visible in the canvas');await page.evaluate(()=>renderPreview('1:1'));await page.waitForTimeout(100);assert.equal(await page.getByRole('alert').count(),0);
 await page.evaluate(()=>{document.getElementById("root").className="";window.applied=[];root.render(React.createElement(load('components/EditorInspector').default,{draft:{hook:'',hook_style:'IMPACT',caption_style:'BOLD',caption_color:'white',caption_position:'bottom'},cue:{id:'c',text:'Caption',start_ms:101000,end_ms:102000},sourceStart:100,sourceEnd:110,hooks:[],disabled:false,onCue:c=>applied.push(c),onChange:()=>{},onTrim:()=>{}}));});
 await page.getByLabel('Selected start seconds').fill('103');await page.getByRole('button',{name:'Apply timing'}).click();
 assert.equal(await page.evaluate(()=>applied.length),0,'Reversed caption timing must not commit');await page.getByRole('alert').waitFor();
 for(const [start,end] of [['99','102'],['101','111'],['','102'],['101','101.05']]){await page.getByLabel('Selected start seconds').fill(start);await page.getByLabel('Selected end seconds').fill(end);await page.getByRole('button',{name:'Apply timing'}).click();assert.equal(await page.evaluate(()=>applied.length),0);}
 await page.getByLabel('Selected start seconds').fill('101');await page.getByLabel('Selected end seconds').fill('103');await page.getByRole('button',{name:'Apply timing'}).click();assert.equal(await page.evaluate(()=>applied[0].end_ms),103000);assert.equal(await page.getByRole('alert').count(),0);
 console.log('PASS: mounted square frame matches landscape FFmpeg crop, 16:9 matches actual export; Original dimensions are even; render errors recover; invalid caption timing is rejected.');
 }finally{if(browser)await browser.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
