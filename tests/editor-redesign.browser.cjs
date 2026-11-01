/* Real Next App Router integration using copied production components and an isolated
 * synthetic auth/profile fixture. No production API, credentials or Sparks. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = process.cwd();
const fixtureRoot = path.resolve(root, '.next-verification');
fs.mkdirSync(fixtureRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(fixtureRoot, 'editor-next-'));
const port = 3132;
const url = `http://localhost:${port}`;
const clipId = '00000000-0000-0000-0000-000000000001';
const editorPath = `/dashboard/clips/${clipId}/edit`;
const write = (file, text) => { const dest = path.join(fixture, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const copy = (file, dest = file) => write(dest, fs.readFileSync(path.join(root, file)));
const clip = { id: clipId, title: 'Synthetic geography clip', start_seconds: 0, end_seconds: 18, url: 'fixture', hooks: ['GEOGRAPHY LIVE'], words: Array.from({ length: 32 }, (_, i) => ({ text: ['Wait,', 'is', 'France', 'in', 'the', 'EU?', 'Chat', 'what?'][i % 8], start: i * 500, end: i * 500 + 400 })) };
for (const dir of ['components', 'lib']) fs.cpSync(path.join(root, dir), path.join(fixture, dir), { recursive: true });

write('package.json', JSON.stringify({ private: true, dependencies: { next: '14.2.35', react: '^18', 'react-dom': '^18' } }));
copy('tsconfig.json');
write('next.config.mjs', 'export default { experimental: { externalDir: true } };');
write('components/SparksProvider.tsx', '"use client"; export function SparksProvider({children}:{children:React.ReactNode}){return children;} export function useSparks(){return {tier:"pro",balance:100,refresh:async()=>{},sync:()=>{}};}');
write('lib/processing-api.ts', 'export const processingFetch:typeof fetch=(...args)=>fetch(...args);');
write('lib/supabase/server.ts', `export async function createClient(){const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:${JSON.stringify(clip)},error:null})};return {auth:{getUser:async()=>({data:{user:{id:'fixture-user'}}})},from:()=>query};}`);
const hasProvider = fs.existsSync(path.join(root, 'components/NavigationGuardProvider.tsx'));
write('app/layout.tsx', `${hasProvider ? 'import {NavigationGuardProvider} from "@/components/NavigationGuardProvider";' : ''} import './globals.css'; export default function Root({children}:{children:React.ReactNode}){return <html><body>${hasProvider ? '<NavigationGuardProvider>{children}</NavigationGuardProvider>' : '{children}'}</body></html>}`);
const newRoute = 'app/(editor)/dashboard/clips/[id]/edit/page.tsx';
copy(fs.existsSync(path.join(root, newRoute)) ? newRoute : 'app/(dashboard)/dashboard/clips/[id]/edit/page.tsx', newRoute);
if (fs.existsSync(path.join(root, 'app/(editor)/layout.tsx'))) copy('app/(editor)/layout.tsx');
else {
 copy('app/(dashboard)/layout.tsx', 'app/(editor)/layout.tsx');
 write('components/Sidebar.tsx', 'export default function Sidebar(){return <nav aria-label="Dashboard sidebar"><a href="/">Dashboard home</a></nav>}');
 write('components/MobileNav.tsx', 'export default function MobileNav(){return <nav aria-label="Mobile dashboard"><a href="/">Dashboard home</a></nav>}');
}
write('app/page.tsx', `import Link from 'next/link'; export default function Home(){return <Link href="${editorPath}">Open fixture editor</Link>}`);
write('app/dashboard/clips/page.tsx', `import Link from 'next/link'; export default function Clips(){return <><h1>Fixture clips</h1><Link href="${editorPath}">Open fixture editor</Link></>}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', path.join(root, 'app/globals.css'), '-o', path.join(fixture, 'app/globals.css')], { cwd: root, windowsHide: true, stdio: 'pipe' });
const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', fixture, '-p', String(port)], { cwd: fixture, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
 let browser;
 try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(url)).ok) break; } catch {} await wait(250); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const video=process.env.EDITOR_CAPTURE_VIDEO || path.join(fixture,'fixture-video.mp4');
  if(!process.env.EDITOR_CAPTURE_VIDEO) execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=960x540:r=15:d=18','-f','lavfi','-i','sine=frequency=440:duration=18','-c:v','libx264','-preset','ultrafast','-crf','30','-c:a','aac','-shortest','-y',video],{windowsHide:true,stdio:'pipe'});
  await page.route('**/api/preview*', route=>route.fulfill({status:200,contentType:'video/mp4',path:video}));
  await page.route('**/api/vertical-layout*', route=>route.fulfill({json:{}}));
  await page.route('**/api/clips/*/media*', route=>route.fulfill({json:{assets:[]}}));
  await page.route('**/api/clips/*/edit-draft*', route=>route.fulfill({json:{edit_draft:route.request().postDataJSON().draft}}));
  await page.goto(url); await page.getByRole('link',{name:'Open fixture editor'}).click(); await page.getByRole('button',{name:'Captions',exact:true}).waitFor();
  await page.waitForTimeout(1000);
  const out=process.env.EDITOR_CAPTURE_DIR || path.join(root,'outputs','editor-redesign'); fs.mkdirSync(out,{recursive:true});
  for(const size of [{width:1920,height:1080},{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(size); await page.waitForTimeout(200);
   const transport=await page.evaluate(()=>{const rect=selector=>{const r=document.querySelector(selector)?.getBoundingClientRect();return r&&{left:r.left,right:r.right,center:(r.left+r.right)/2};};return {bar:rect('.editor-transport'),center:rect('.editor-transport-center'),time:rect('.editor-time'),playback:rect('.editor-playback'),volume:rect('.editor-volume'),format:rect('.editor-transport select')};});
   assert(transport.center,`playback controls should be grouped at ${size.width}`);
   assert(Math.abs(transport.center.center-transport.bar.center)<4,`playback group should be centered at ${size.width}`);
   assert(transport.playback.left-transport.time.right<=24,`time should sit beside playback at ${size.width}`);
   assert(transport.volume.right<transport.center.left&&transport.center.right<transport.format.left,`playback bar controls should not overlap at ${size.width}`);
   const metrics=await page.evaluate(()=>({docWidth:document.documentElement.scrollWidth,viewportWidth:window.innerWidth,preview:(()=>{const r=document.querySelector('.editor-canvas').getBoundingClientRect();return {width:r.width,height:r.height}})(),timeline:(()=>{const r=document.querySelector('.editor-timeline').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}})()}));
   console.log(size,metrics); if(size.width===390){const overlap=await page.evaluate(()=>{const status=document.querySelector('.editor-header>span').getBoundingClientRect(),save=[...document.querySelectorAll('.editor-header>button')].find(b=>b.textContent.trim()==='Save').getBoundingClientRect();return status.left<save.right&&status.right>save.left&&status.top<save.bottom&&status.bottom>save.top});assert.equal(overlap,false,'mobile Save overlaps status');} assert(metrics.preview.height >= (size.width===1920?480:size.width>=960?300:120), `preview too small at ${size.width}`); if(size.width>=960)assert(Math.abs(metrics.preview.width/metrics.preview.height-16/9)<.05,`preview frame squeezed at ${size.width}`); assert(metrics.timeline.height <= (size.width<=640?420:280), `timeline too tall at ${size.width}`); assert(metrics.docWidth<=metrics.viewportWidth, `horizontal overflow at ${size.width}`); await page.screenshot({path:path.join(out,`${size.width}x${size.height}.png`)}); if(size.width===390) { await page.locator('.editor-inspector').screenshot({path:path.join(out,'mobile-captions-panel.png')}); await page.locator('.editor-inspector-tabs').getByRole('button',{name:'Hook'}).click(); await page.locator('.editor-inspector').screenshot({path:path.join(out,'mobile-hook-panel.png')}); await page.locator('.editor-inspector-tabs').getByRole('button',{name:'Captions'}).click(); }
  }
  await page.setViewportSize({width:1366,height:768}); await page.waitForTimeout(150);
  assert.deepEqual(await page.locator('.editor-inspector-tabs button').allTextContents(),['Captions','Hook','Layout']);
  assert.equal(await page.getByRole('combobox',{name:'Caption style'}).count(),0,'no duplicate caption style dropdown');
  assert.equal(await page.locator('.caption-template-card:visible').count(),4,'four templates appear first');
  await page.getByRole('button',{name:'See all 10 styles'}).click();
  assert.equal(await page.locator('.caption-template-card:visible').count(),10,'all styles remain available');
  await page.getByRole('button',{name:'Bounce caption template'}).click();
  await page.locator('.editor-fine-tune summary').click();
  await page.getByRole('button',{name:'Center caption position'}).click();
  assert.equal(await page.getByRole('button',{name:'Center caption position'}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Hook',exact:true}).click();
  assert.equal(await page.getByLabel('Hook text').count(),1);
  await page.getByRole('button',{name:'White box hook style'}).click();
  assert.equal(await page.getByRole('button',{name:'White box hook style'}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'Show saved hook suggestions'}).click();
  assert.equal(await page.getByRole('button',{name:'GEOGRAPHY LIVE'}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'Hook style'}).count(),1);
  await page.getByRole('button',{name:'Captions',exact:true}).click();
  assert.equal(await page.getByRole("button",{name:"Captions panel"}).count(),0);
  assert.equal(await page.getByRole("button",{name:"Layout panel"}).count(),0);
  assert.equal(await page.getByRole("button",{name:"Audio panel"}).count(),1);
  assert.equal(await page.getByRole("button",{name:"Collapse transcript"}).count(),1);
  assert.equal(await page.getByRole("button",{name:"Resize transcript"}).count(),1);
  assert.equal(await page.getByRole("button",{name:"Resize timeline"}).count(),1);
  assert.equal(await page.locator("[aria-label=\"Caption lane\"]").count(),0);
  const leftBefore=await page.locator('.editor-left-panel').boundingBox();
  await page.getByRole('button',{name:'Resize transcript'}).focus(); await page.keyboard.press('ArrowRight');
  const leftAfter=await page.locator('.editor-left-panel').boundingBox(); assert(leftAfter.width>leftBefore.width,'keyboard resize should widen transcript');
  const leftGrip=await page.getByRole('button',{name:'Resize transcript'}).boundingBox();
  await page.mouse.move(leftGrip.x+leftGrip.width/2,leftGrip.y+40); await page.mouse.down(); await page.mouse.move(leftGrip.x+leftGrip.width/2+40,leftGrip.y+40,{steps:4}); await page.mouse.up();
  assert((await page.locator('.editor-left-panel').boundingBox()).width>leftAfter.width,'pointer resize should widen transcript');
  await page.getByRole('button',{name:'Collapse transcript'}).click(); assert.equal(await page.locator('.editor-left-panel').isVisible(),false);
  await page.getByRole('button',{name:'Expand transcript'}).click(); assert.equal(await page.locator('.editor-left-panel').isVisible(),true);
  const timelineBefore=await page.locator('.editor-timeline').boundingBox();
  await page.getByRole('button',{name:'Resize timeline'}).focus(); await page.keyboard.press('ArrowUp');
  const timelineAfter=await page.locator('.editor-timeline').boundingBox(); assert(timelineAfter.height>timelineBefore.height,'keyboard resize should enlarge timeline');
  const timelineGrip=await page.getByRole('button',{name:'Resize timeline'}).boundingBox();
  await page.mouse.move(timelineGrip.x+timelineGrip.width/2,timelineGrip.y+timelineGrip.height/2); await page.mouse.down(); await page.mouse.move(timelineGrip.x+timelineGrip.width/2,timelineGrip.y-25,{steps:4}); await page.mouse.up();
  assert((await page.locator('.editor-timeline').boundingBox()).height>timelineAfter.height,'pointer resize should enlarge timeline');
  await page.getByRole('button',{name:'Collapse timeline'}).click(); assert((await page.locator('.editor-timeline').boundingBox()).height<=44);
  await page.getByRole('button',{name:'Expand timeline'}).click(); assert((await page.locator('.editor-timeline').boundingBox()).height>44);
  await page.locator('.editor-inspector-tabs').getByRole('button',{name:'Layout'}).click(); assert.equal(await page.getByRole('heading',{name:'Layout',exact:true}).count(),1);
  for(const [format,ratio] of [['9:16',9/16],['1:1',1],['16:9',16/9],['Original',16/9]]){
   await page.getByLabel('Export aspect ratio').selectOption(format); await page.waitForTimeout(80);
   const frame=await page.locator('.editor-canvas').boundingBox(); assert(Math.abs(frame.width/frame.height-ratio)<.06,format+' preview frame ratio');
   if(format==='9:16')assert.equal(await page.locator('.editor-frame-controls').count(),1,'vertical framing controls remain available');
  }
  await page.getByRole('button',{name:'Audio panel'}).click(); assert.equal(await page.getByRole('heading',{name:'Speech polish'}).count(),1);
  await page.locator('.editor-inspector-tabs').getByRole('button',{name:'Captions'}).click(); assert.equal(await page.getByLabel('Hook text').count(),0);
  await page.getByRole('button',{name:'Media panel'}).click(); assert.equal(await page.getByRole('button',{name:'Add photo'}).count(),1);
  await page.getByRole('button',{name:'Transcript panel'}).click(); assert.equal(await page.getByLabel('Search transcript').count(),1);
  assert((await page.locator('.editor-transcript-lines button').count())<clip.words.length/4,'timed words appear in readable paragraphs');
  assert.equal(await page.locator('.editor-transcript-lines button time').first().textContent(),'[00:00–00:10]');
  assert.equal(await page.locator('.editor-cleanup').getAttribute('open'),null,'cleanup starts collapsed');
  await page.getByText('Captions are optional. Add them from the saved transcript when you are ready.').waitFor();
  await page.getByRole('button',{name:'Add captions'}).click();
  const phraseButtons=page.locator('[aria-label="Caption lane"] button');
  assert((await phraseButtons.count())>0,'caption generation creates visible timed cues');
  assert((await phraseButtons.count())<clip.words.length/2,'normal zoom groups words into readable phrases');
  await phraseButtons.first().click();
  assert((await page.getByLabel('Selected caption words').getByRole('button').count())>2,'a phrase opens its individual word controls');
  await page.getByLabel('Selected caption words').getByRole('button').nth(1).click();
  assert.equal(await page.getByLabel('Selected caption words').getByRole('button').nth(1).getAttribute('aria-pressed'),'true','individual words remain selectable');
  await page.screenshot({path:path.join(out,'caption-phrases.png')});
  assert.equal(await page.getByText('Captions are optional. Add them from the saved transcript when you are ready.').count(),0);
  assert.deepEqual(errors,[]);
 }catch(error){console.error(serverLog.slice(-6000));throw error}finally{if(browser)await browser.close();server.kill()}
})().catch(error=>{console.error(error);process.exitCode=1});
