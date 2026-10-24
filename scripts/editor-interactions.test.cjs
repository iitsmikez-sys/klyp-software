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
const port = 3127;
const url = `http://localhost:${port}`;
const clipId = '00000000-0000-0000-0000-000000000001';
const editorPath = `/dashboard/clips/${clipId}/edit`;
const write = (file, text) => { const dest = path.join(fixture, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text); };
const copy = (file, dest = file) => write(dest, fs.readFileSync(path.join(root, file)));
const clip = { id: clipId, title: 'Synthetic geography clip', start_seconds: 100, end_seconds: 118, url: 'fixture', hooks: ['GEOGRAPHY LIVE'], words: Array.from({ length: 32 }, (_, i) => ({ text: ['Wait,', 'is', 'France', 'in', 'the', 'EU?', 'Chat', 'what?'][i % 8], start: 100000 + i * 500, end: 100400 + i * 500 })) };
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let requests = 0, delaySave = false, releaseSave;
  await page.route('**/api/preview', route => { requests++; return route.fulfill({ status: 200, contentType: 'video/mp4', body: 'not a decodable MP4' }); });
  await page.route('**/api/vertical-layout', route => route.fulfill({ json: {} }));
  await page.route('**/api/clips/*/media', route => route.fulfill({ json: { assets: [] } }));
  await page.route('**/api/clips/*/edit-draft', async route => { const draft = route.request().postDataJSON().draft; if (delaySave) await new Promise(resolve => releaseSave = resolve); await route.fulfill({ json: { edit_draft: draft } }); });
  await page.goto(url); await page.getByRole('link', { name: 'Open fixture editor' }).click(); await page.getByLabel('Hook text').waitFor();
  // A successful HTTP request can still fail decoding. Retry must be reachable.
  const retry = page.getByRole('button', { name: 'Retry preview' }); await retry.waitFor();
  const bounds = await retry.boundingBox(); assert(bounds && bounds.width > 20 && bounds.height > 10, 'decode Retry must not be clipped');
  const beforeRetry = requests; await retry.click(); await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes('cannot be decoded'));
  assert(requests > beforeRetry, 'Retry must request the footage again');
  // Set up genuine forward and backward Next history around the editor.
  await page.getByRole('button', { name: 'Back to clips' }).click(); await page.getByRole('heading', { name: 'Fixture clips' }).waitFor();
  await page.goBack(); await page.getByLabel('Hook text').waitFor();
  await page.getByLabel('Hook text').fill('Unsaved navigation draft');
  await page.evaluate(() => { window.editorNode = document.querySelector('.clip-editor'); });
  for (const direction of ['forward', 'back']) {
   const dialog = page.waitForEvent('dialog'); await page.evaluate(direction => history[direction](), direction); const prompt = await dialog; await prompt.dismiss();
   await page.waitForURL(url + editorPath); await wait(200);
   assert.equal(await page.getByLabel('Hook text').inputValue(), 'Unsaved navigation draft');
   assert(await page.evaluate(() => window.editorNode === document.querySelector('.clip-editor')), direction + ' Cancel must preserve the mounted editor');
  }
  // Native button activation must not be stolen by the Space transport shortcut.
  await page.getByRole('button', { name: 'Style', exact: true }).focus(); await page.keyboard.press('Space');
  assert.equal(await page.getByRole('button', { name: 'Style', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Play', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Caption color yellow' }).focus(); await page.keyboard.press('Space');
  assert.equal(await page.getByRole('button', { name: 'Caption color yellow' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  // Confirm normalization and pending edits in the actual mounted editor.
  await page.getByLabel('Clip title').fill('  Normalized title  '); await page.getByLabel('Hook text').fill('  Normalized hook  ');
  await page.locator('[aria-label="Caption lane"] button').first().click(); await page.getByLabel('Caption text', { exact: true }).fill('  Normalized caption  ');
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Saved to Klyp', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Clip title').inputValue(), 'Normalized title'); assert.equal(await page.getByLabel('Hook text').inputValue(), 'Normalized hook'); assert.equal(await page.getByLabel('Caption text', { exact: true }).inputValue(), 'Normalized caption');
  delaySave = true; await page.getByLabel('Clip title').fill('  Server title  '); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText('Saving…', { exact: true }).waitFor();
  await page.getByLabel('Hook text').fill('new hook while saving'); while (!releaseSave) await wait(10); releaseSave(); await page.getByText('Unsaved changes', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Clip title').inputValue(), 'Server title'); assert.equal(await page.getByLabel('Hook text').inputValue(), 'new hook while saving');
  // Route has no background dashboard UI, and every keyboard stop stays inside.
  assert.equal(await page.locator('nav:not(.editor-rail)').count(), 0);
  await page.getByRole('button', { name: 'Back to clips' }).focus();
  for (let i = 0; i < 70; i++) { await page.keyboard.press('Tab'); const focus=await page.evaluate(() => ({inside:document.activeElement === document.body || !!document.activeElement.closest('.clip-editor') || document.activeElement.tagName.toLowerCase()==='nextjs-portal',html:document.activeElement.outerHTML.slice(0,300)})); assert(focus.inside,`Tab must not reach dashboard controls: ${focus.html}`); }
  assert.deepEqual(errors, []);
  console.log('PASS: actual Next Back/Forward Cancel preserves editor identity and dirty state; decode Retry visible and works; Space activates tabs/presets; normalized saves reconcile without overwriting pending edits; no background navigation/focus path.');
 } catch (error) { console.error(serverLog.slice(-6000)); throw error; }
 finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
