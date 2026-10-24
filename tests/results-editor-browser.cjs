const {chromium}=require('playwright');
const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
// Run against the local dev server with NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
// and a dummy NEXT_PUBLIC_SUPABASE_ANON_KEY. All service calls below are fixtures.
fs.mkdirSync('work',{recursive:true});
fs.mkdirSync('app/results-check-local',{recursive:true});
fs.writeFileSync('app/results-check-local/page.tsx', 'import AnalyzePanel from "@/components/AnalyzePanel"; import {SparksProvider} from "@/components/SparksProvider"; export default function Check(){return <SparksProvider><main className="mx-auto max-w-6xl p-6"><AnalyzePanel/></main></SparksProvider>}');
const pro=process.env.KLYP_TEST_TIER==='pro';
const browser=await chromium.launch({headless:true});try{
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let count=2, spent=17, saveFails=false, exports=[], saved=0, holdExport=false, releaseExport, thumbnailFailures=2, exportFails=false;
const clips=Array.from({length:2},(_,i)=>({title:i?'The reaction nobody expected':'An unexpected moment with perfect timing',type:'FUNNY',viral_score:82-i*4,reason:'A clear payoff with an unexpected reaction.',caption:'A moment worth sharing #stream #klyp',start_seconds:i*30,end_seconds:i*30+25,hooks:['WATCH WHAT HAPPENS NEXT','CHAT DID NOT EXPECT THIS','THE TIMING WAS PERFECT'],words:'We found a great moment in the stream today watch what happens next this is the clip we wanted to share'.split(' ').map((text,j)=>({text,start:(i*30+j)*1000,end:(i*30+j+1)*1000}))}));
await page.route('**/api/health',r=>r.fulfill({json:{ok:true}}));
await page.route('**/api/duration?*',r=>r.fulfill({json:{durationSeconds:600,sparks:10}}));
await page.route('**/api/analyze',r=>r.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'result',clips:clips.slice(0,count),requestedClips:5,sparksSpent:spent,sparksBalance:100})+'\n\n'}));
await page.route('**/api/preview',r=>r.fulfill({contentType:'video/mp4',path:'public/demo/clip-1.mp4'}));
await page.route('**/api/thumbnail',r=>r.fulfill(thumbnailFailures-->0?{status:503,json:{error:'Temporary thumbnail failure'}}:{contentType:'image/jpeg',path:'public/demo/clip-1.jpg'}));
await page.route('**/api/clip',async r=>{exports.push(r.request().postDataJSON());if(holdExport)await new Promise(resolve=>releaseExport=resolve);return r.fulfill(exportFails?{status:500,json:{error:'Test export failed'}}:{contentType:'video/mp4',path:'public/demo/clip-1.mp4'})});
await page.route('**/rest/v1/rpc/get_profile',r=>r.fulfill({json:{sparks:100,tier:pro?'pro':'free',stripe_subscription_id:pro?'sub_fixture':null}}));
await page.route('**/auth/v1/user',r=>r.fulfill({json:{id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'fixture@example.com'}}));
await page.route('**/rest/v1/clips*',r=>{saved++;return r.fulfill(saveFails?{status:500,json:{message:'Test save failed'}}:{json:[{id:'22222222-2222-4222-8222-222222222222'}]})});
await page.addInitScript(()=>{window.__watermarkDraws=0;const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(text==='klyp.world')window.__watermarkDraws++;return fill.call(this,text,...args)};const enc=x=>btoa(JSON.stringify(x));const token=enc({alg:'HS256'})+'.'+enc({sub:'11111111-1111-4111-8111-111111111111',exp:Math.floor(Date.now()/1000)+3600})+'.fixture';const session=JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:'11111111-1111-4111-8111-111111111111'}});document.cookie='sb-example-auth-token=base64-'+btoa(session)+'; path=/';});
await page.goto('http://127.0.0.1:3018/results-check-local');
// Next's route watcher may briefly serve its cached 404 after fixture creation.
for(let attempt=0;attempt<10 && await page.locator('input[type=url]').count()===0;attempt++) {
  await page.waitForTimeout(1000);
  await page.reload();
}
await page.locator('input[type=url]').fill('https://youtu.be/fixture');
await page.getByText('30 Sparks',{exact:false}).first().waitFor();
await page.locator('button[type=submit]').click();
await page.getByRole('heading',{name:'We found 2 great moments!',exact:false}).waitFor();
await page.waitForTimeout(1400);
assert.equal(await page.locator('article').count(),2);
await page.getByRole('button',{name:/Retry thumbnail/}).first().click();
await page.locator('article').first().locator('img').waitFor();
await page.getByText('You saved 13 Sparks',{exact:false}).waitFor();
await page.locator('article').first().scrollIntoViewIfNeeded();await page.screenshot({path:'work/stage-two-desktop.png',fullPage:true});
await page.evaluate(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(key.startsWith('klyp-editor-'))throw new Error('Storage disabled');return get.call(this,key)};Storage.prototype.setItem=function(key,value){if(key.startsWith('klyp-editor-'))throw new Error('Storage disabled');return set.call(this,key,value)}});
await page.getByRole('button',{name:'Customize',exact:true}).first().click();
await page.getByRole('dialog').waitFor();await page.waitForFunction(()=>document.querySelector('[role=dialog] video')?.readyState>=2);
await page.getByRole('combobox',{name:'Export format'}).selectOption('1:1');
if(pro){assert.equal(await page.getByRole('combobox',{name:'Export format'}).inputValue(),'1:1');await page.getByRole('combobox',{name:'Export format'}).selectOption('16:9');}
else{await page.getByRole('heading',{name:'This is a Pro feature'}).waitFor();await page.getByRole('button',{name:'Maybe later'}).click();assert.equal(await page.getByRole('combobox',{name:'Export format'}).inputValue(),'9:16');}
await page.getByRole('button',{name:'Yellow',exact:true}).click();
await page.getByRole('button',{name:'Center',exact:true}).click();
await page.waitForTimeout(100);
assert.equal((await page.evaluate(()=>window.__watermarkDraws))>0,!pro);

await page.getByRole('button',{name:'CHAT DID NOT EXPECT THIS',exact:false}).click();
await page.getByRole('combobox',{name:'Export format'}).selectOption('Original');
await page.getByRole('button',{name:'Close preview'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
exportFails=true;await page.getByRole('button',{name:'↓ Export',exact:true}).first().click();await page.getByRole('alert').getByText('Test export failed').waitFor();exportFails=false;exports=[];
const download=page.waitForEvent('download');await page.getByRole('button',{name:'↓ Export',exact:true}).first().click();await download;
assert.equal(exports[0].hook,'CHAT DID NOT EXPECT THIS');assert.equal(exports[0].aspect_ratio,'Original');assert.ok(exports[0].segments);assert.equal(exports[0].caption_color,'YELLOW');assert.equal(exports[0].caption_position,'CENTER');
await page.getByRole('button',{name:'Customize',exact:true}).first().click();
assert.equal(await page.getByRole('combobox',{name:'Export format'}).inputValue(),'Original');
saveFails=true;await page.getByRole('button',{name:'Keep clip to add media'}).click();await page.getByRole('dialog').getByRole('alert').getByText('Test save failed').waitFor();
saveFails=false;await page.getByRole('button',{name:'Keep clip to add media'}).click();await page.getByRole('button',{name:'Keep clip to add media'}).waitFor({state:'hidden'});
await page.getByRole('button',{name:'Close preview'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByText('Saved to Found Moments',{exact:false}).waitFor();assert.equal(saved,2);
await page.getByRole('button',{name:'Customize',exact:true}).first().click();
holdExport=true;const editorDownload=page.waitForEvent('download');
await page.getByRole('button',{name:'↑ Export',exact:true}).click();
await page.getByRole('button',{name:'Close preview'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
assert.equal(await page.getByRole('button',{name:'Exporting…',exact:true}).isDisabled(),true);
assert.equal(await page.getByRole('button',{name:'Download all (.zip)',exact:true}).isDisabled(),true);
for(let i=0;i<40&&!releaseExport;i++)await page.waitForTimeout(50);
assert.ok(releaseExport);releaseExport();await editorDownload;holdExport=false;
assert.equal(exports.length,2);

await page.getByRole('button',{name:'Discard',exact:true}).click();assert.equal(await page.locator('article').count(),1);
await page.getByRole('heading',{name:'We found 2 great moments!',exact:false}).waitFor();
await page.setViewportSize({width:390,height:844});await page.locator('article').first().scrollIntoViewIfNeeded();await page.screenshot({path:'work/stage-two-mobile.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
count=0;spent=10;await page.locator('button[type=submit]').click();await page.getByText('No new moments cleared',{exact:false}).waitFor();assert.equal(await page.locator('article').count(),0);
await page.waitForTimeout(1400);count=1;spent=30;await page.locator('button[type=submit]').click();await page.getByRole('heading',{name:'We found 1 great moment!',exact:false}).waitFor();await page.getByText('Charged 30 Sparks for this analysis.').waitFor();
assert.deepEqual(errors,[]);console.log(pro?'PRO fixture':'FREE fixture');console.log('PASS: thumbnail retry, export failure/retry, caption color/position, format restrictions, watermark preview,  results 0/1/2, actual savings/neutral charge, editor reopen, card export selections, Keep failure/retry, Discard, desktop/mobile overflow, storage-disabled reopen and active-export lock after closing; no runtime errors.');
}finally{
await browser.close();
fs.unlinkSync('app/results-check-local/page.tsx');
fs.rmdirSync('app/results-check-local');
const generated='.next/types/app/results-check-local/page.ts';
if(fs.existsSync(generated))fs.unlinkSync(generated);
}
})().catch(e=>{console.error(e);process.exitCode=1});
