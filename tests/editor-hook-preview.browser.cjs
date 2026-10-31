const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto('http://localhost:3133/dashboard/clips/00000000-0000-0000-0000-000000000001/edit');
    await page.locator('video').waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    if (!await page.getByRole('button', { name: 'Export clip' }).isVisible()) throw new Error('Local preview is not in mock Pro mode');
    const scrubber = page.getByLabel('Playhead position');
    await scrubber.scrollIntoViewIfNeeded();
    const box = await scrubber.boundingBox();
    await page.mouse.click(box.x + box.width / 3, box.y + box.height / 2);
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 5);
    await page.getByRole('button', { name: 'Hook', exact: true }).click();
    const hook = page.getByLabel('Hook text');
    await hook.click();
    await hook.fill('AURA');
    await page.waitForFunction(() => document.querySelector('video')?.currentTime < 1);
    await page.locator('[data-text-kind="hook"]').waitFor({ state: 'visible' });
    await page.screenshot({ path: 'C:/Users/Michael/Documents/Codex/2026-10-22/a/editor-preview/hook-visible-at-start.png' });
    console.log('PASS mock Pro preview shows a typed hook by returning to its first three seconds');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
