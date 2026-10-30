const { chromium } = require('playwright');

const url = process.env.EDITOR_TEST_URL || 'http://localhost:3133/dashboard/clips/00000000-0000-0000-0000-000000000001/edit';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(url);
    const videoLane = page.locator('[aria-label="Video lane"]');
    await page.locator('video').waitFor();
    await page.getByText('Loading frames…').waitFor({ state: 'hidden', timeout: 30000 });
    await page.getByText('Loading audio…').waitFor({ state: 'hidden', timeout: 30000 });
    await page.evaluate(() => {
      window.__mediaReloads = [];
      const timeline = document.querySelector('[aria-label="Clip timeline"]');
      new MutationObserver(() => {
        const text = timeline.textContent;
        if (text.includes('Loading frames') || text.includes('Loading audio')) window.__mediaReloads.push(text);
      }).observe(timeline, { subtree: true, childList: true, characterData: true });
    });
    await page.getByLabel('Hook text').fill('AURA');
    await page.getByLabel('Caption position').selectOption('center');
    await page.waitForTimeout(500);
    const reloads = await page.evaluate(() => window.__mediaReloads.length);
    if (reloads) throw new Error(`Text changes restarted timeline media ${reloads} time(s)`);
    if (!await videoLane.isVisible()) throw new Error('Video lane disappeared');
    await page.screenshot({ path: 'C:/Users/Michael/Documents/Codex/2026-10-22/a/editor-preview/media-stable-after-text.png' });
    await page.getByText('Trim selected clip').click();
    const start = page.getByLabel('Selected start seconds');
    const nextStart = Number(await start.inputValue()) + 0.1;
    await start.fill(String(nextStart));
    await page.getByRole('button', { name: 'Apply timing' }).click();
    await page.waitForTimeout(100);
    const trimReloads = await page.evaluate(() => window.__mediaReloads.length);
    if (!trimReloads) throw new Error('Changed segment times did not refresh timeline media');
    console.log('PASS text edits keep decoded frames and audio waveform');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
