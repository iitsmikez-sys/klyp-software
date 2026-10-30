const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.dirname(__dirname);
const routeDir = path.join(root, 'app', 'dashboard-visual-local');
const artifactDir = path.join(root, 'artifacts', 'dashboard-redesign');
const label = process.argv.includes('--before') ? 'before' : 'after';
const captureOnly = process.argv.includes('--before');
const base = process.env.KLYP_TEST_BASE_URL ?? 'http://127.0.0.1:3019';

const clips = [
  { id: '11111111-1111-4111-8111-111111111111', url: 'https://www.twitch.tv/videos/2914400537', title: 'The joke caught everyone off guard', clip_type: 'FUNNY', viral_score: 82, caption: null, reason: null, start_seconds: 125, end_seconds: 152, created_at: '2026-10-29T20:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', url: 'https://www.twitch.tv/videos/2914400537', title: 'A perfect game-winning play', clip_type: 'CLUTCH', viral_score: 87, caption: null, reason: null, start_seconds: 730, end_seconds: 764, created_at: '2026-10-29T19:00:00Z' },
  { id: '33333333-3333-4333-8333-333333333333', url: 'https://www.twitch.tv/videos/2914400537', title: 'Chat did not expect that reaction', clip_type: 'EPIC', viral_score: 79, caption: null, reason: null, start_seconds: 1800, end_seconds: 1845, created_at: '2026-10-29T18:00:00Z' },
];

(async () => {
  fs.mkdirSync(routeDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(routeDir, 'page.tsx'), 'import DashboardLayout from "@/app/(dashboard)/layout"; import DashboardPage from "@/app/(dashboard)/dashboard/page"; export default function Preview(){ return <DashboardLayout><DashboardPage /></DashboardLayout>; }');
  const browser = await chromium.launchPersistentContext(path.join(artifactDir, 'chrome-profile'), { headless: true, channel: 'chrome' });
  try {
    const viewports = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 },
      ...(!captureOnly ? [{ width: 1280, height: 800 }, { width: 390, height: 844 }] : [])];
    for (const viewport of viewports) {
      const page = await browser.newPage();
      await page.setViewportSize(viewport);
      const pageErrors = [];
      let badProbe = false;
      const analysisBodies = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.route('**/api/health', route => route.fulfill({ json: { ok: true } }));
      await page.route('**/api/duration?*', route => route.fulfill({ json: badProbe ? { durationSeconds: null, sparks: null } : { durationSeconds: 8100, sparks: 50, title: 'An evening of Just Chatting', thumbnail: '/demo/clip-1.jpg', source: 'Twitch' } }));
      await page.route('**/api/thumbnail', route => route.fulfill({ contentType: 'image/jpeg', path: path.join(root, 'public', 'demo', 'clip-1.jpg') }));
      await page.route('**/api/analyze', route => {
        analysisBodies.push(route.request().postDataJSON());
        return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'result', clips: [], requestedClips: 3, sparksSpent: 50, sparksBalance: 215 })}\n\n` });
      });
      await page.route('**/auth/v1/user', route => route.fulfill({ json: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', aud: 'authenticated', role: 'authenticated', email: 'creator@example.com' } }));
      await page.route('**/rest/v1/rpc/get_profile', route => route.fulfill({ json: { sparks: 265, tier: 'free', sparks_reset_at: '2026-11-18T00:00:00Z', stripe_subscription_id: null } }));
      await page.route('**/rest/v1/clips*', route => route.fulfill({ json: clips }));
      await page.route('**/rest/v1/streams*', route => route.fulfill({ json: [] }));
      await page.route('**/rest/v1/transcripts*', route => route.fulfill({ json: [] }));
      await page.addInitScript(() => {
        localStorage.setItem('klyp-content-type', 'gaming');
        const encode = value => btoa(JSON.stringify(value));
        const token = encode({ alg: 'HS256' }) + '.' + encode({ sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.fixture';
        const session = JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'creator@example.com' } });
        document.cookie = 'sb-example-auth-token=base64-' + btoa(session) + '; path=/';
      });
      await page.goto(`${base}/dashboard-visual-local`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Analyze a VOD' }).waitFor();
      if (!captureOnly) assert.equal(await page.getByRole('button', { name: 'Find Clips' }).isDisabled(), true, 'cannot start before pricing');
      await page.getByLabel('VOD URL').fill('https://www.twitch.tv/videos/2914400537');
      await page.locator('details').first().locator('summary').click();
      await page.getByRole('button', { name: /^3 clips/ }).click();
      await page.getByText('60 Sparks', { exact: false }).first().waitFor();
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(artifactDir, `${label}-${viewport.width}x${viewport.height}.png`), fullPage: false });
      if (!captureOnly) {
        assert.equal(await page.getByRole('button', { name: /Find clips/i }).count(), 1, 'one primary Find Clips action');
        assert.equal(await page.getByRole('button', { name: 'Find Clips' }).isEnabled(), true, 'can start after cost is known');
        assert.equal(await page.getByText('An evening of Just Chatting').count(), 1, 'VOD metadata preview');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
        for (const count of [3, 5, 7, 10]) {
          assert.match(await page.getByRole('button', { name: new RegExp(`^${count} clips`) }).textContent(), /⚡/, `${count}-clip price keeps its small Spark icon`);
        }
        await page.getByRole('button', { name: /^10 clips/ }).click();
        assert.equal(await page.getByText('90 Sparks', { exact: false }).count() > 0, true, 'selected clip count updates the estimate');
        await page.getByRole('button', { name: /^3 clips/ }).click();
        await page.getByLabel('VOD URL').fill('https://www.twitch.tv/videos/2914400538');
        assert.equal(await page.getByRole('button', { name: 'Find Clips' }).isDisabled(), true, 'new URL cannot use prior cost');
        await page.getByLabel('VOD URL').fill('https://www.twitch.tv/videos/2914400537');
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Find Clips' && !button.disabled));
        await page.locator('details').first().locator('summary').click();
        assert.match(await page.locator('details').first().locator('summary').innerText(), /3 clips.*Gaming/);
        if (viewport.width === 1440) await page.screenshot({ path: path.join(artifactDir, 'after-collapsed-1440x900.png'), fullPage: false });
        await page.getByRole('button', { name: 'Upload file' }).click();
        assert.equal(await page.getByRole('button', { name: 'Find Clips' }).isDisabled(), true, 'cannot start before upload completes');
        assert.equal(await page.getByText('Drop your VOD file here').count(), 1);
        assert.equal(await page.getByRole('link', { name: 'Edit Clip' }).count(), 3, 'saved clips retain editing entry points');
        badProbe = true;
        await page.getByRole('button', { name: 'Paste URL' }).click();
        await page.getByLabel('VOD URL').fill('https://www.twitch.tv/videos/2914400539');
        await page.getByRole('alert').getByText(/Couldn’t confirm the VOD length/).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Find Clips' }).isDisabled(), true, 'invalid estimate cannot start processing');
        badProbe = false;
        await page.getByRole('button', { name: 'Retry' }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Find Clips' && !button.disabled));
        if (viewport.width === 1440) {
          await page.locator('details').first().locator('summary').click();
          await page.getByRole('button', { name: 'IRL' }).click();
          await page.getByLabel('Keyword or topic (optional)').fill('clutch');
          await page.getByRole('button', { name: 'Find Clips' }).click();
          await page.getByText('No new moments cleared the quality floor', { exact: false }).waitFor();
          assert.equal(analysisBodies.length, 1, 'one analysis request');
          assert.equal(analysisBodies[0].clipCount, 3);
          assert.equal(analysisBodies[0].contentType, 'irl');
          assert.equal(analysisBodies[0].keyword, 'clutch');
        }
      }
      assert.deepEqual(pageErrors, [], `browser errors at ${viewport.width}px`);
      await page.close();
    }
    console.log(`${label} dashboard browser check passed at ${viewports.map(v => `${v.width}×${v.height}`).join(', ')}`);
  } finally {
    await browser.close();
    if (!captureOnly) fs.rmSync(routeDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
