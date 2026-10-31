const { chromium } = require('playwright');

const url = process.env.EDITOR_TEST_URL || 'http://localhost:3133/dashboard/clips/00000000-0000-0000-0000-000000000001/edit';

async function assertAligned(page, kind) {
  const result = await page.evaluate(kind => {
    const handle = document.querySelector(`[data-text-kind="${kind}"]`);
    const canvas = document.querySelector('.editor-canvas canvas');
    const box = handle.getBoundingClientRect();
    const frame = canvas.getBoundingClientRect();
    const scale = Math.min(frame.width / canvas.width, frame.height / canvas.height);
    const fitted = { x: frame.x + (frame.width - canvas.width * scale) / 2, y: frame.y + (frame.height - canvas.height * scale) / 2, width: canvas.width * scale, height: canvas.height * scale };
    const anchor = { x: fitted.x + parseFloat(handle.style.left) / 100 * fitted.width, y: fitted.y + parseFloat(handle.style.top) / 100 * fitted.height };
    return { dx: Math.abs(box.x + box.width / 2 - anchor.x), dy: Math.abs(box.y + box.height / 2 - anchor.y) };
  }, kind);
  if (result.dx > 3 || result.dy > 3) throw new Error(`${kind} hitbox misses the painted text: ${JSON.stringify(result)}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, hasTouch: true });
      let saved = null;
      page.on('request', request => {
        if (request.method() === 'PUT' && request.url().includes('/edit-draft')) saved = request.postDataJSON();
      });
      await page.goto(url);
      await page.locator('video').waitFor();
      await page.getByRole('button', { name: 'Hook', exact: true }).click();
      await page.getByLabel('Hook text').fill('AURA');
      for (const label of ['On-video placement', 'Hook size', 'Caption size']) {
        if (await page.getByText(label, { exact: true }).count()) throw new Error(`${label} should not be in the inspector`);
      }
      if (await page.getByRole('button', { name: 'Reset', exact: true }).count()) throw new Error('Text placement Reset button should not be in the inspector');
      if (await page.getByRole('button', { name: 'Transcript panel' }).getAttribute('aria-pressed') !== 'true') throw new Error('Expected Transcript tool to remain selected');
      const hook = page.locator('[data-text-kind="hook"]');
      await hook.waitFor({ state: 'visible', timeout: 2000 });
      await hook.scrollIntoViewIfNeeded();
      await assertAligned(page, 'hook');
      const before = await hook.evaluate(element => element.style.left);
      const box = await hook.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 22, box.y + box.height / 2 + 10, { steps: 4 });
      await page.mouse.up();
      const after = await hook.evaluate(element => element.style.left);
      if (before === after) throw new Error(`Hook did not move at ${viewport.width}px`);
      const corner = await hook.locator('[data-text-resize]').boundingBox();
      await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
      await page.mouse.down();
      await page.mouse.move(corner.x + corner.width / 2 + 20, corner.y + corner.height / 2 + 20, { steps: 4 });
      await page.mouse.up();
      await page.getByRole('button', { name: 'Captions', exact: true }).click();
      await page.getByRole('button', { name: 'Add captions' }).click();
      const caption = page.locator('[data-text-kind="caption"]');
      await caption.waitFor({ state: 'visible', timeout: 2000 });
      await caption.scrollIntoViewIfNeeded();
      await assertAligned(page, 'caption');
      const captionBefore = await caption.evaluate(element => element.style.top);
      const captionBox = await caption.boundingBox();
      await page.mouse.move(captionBox.x + captionBox.width / 2, captionBox.y + captionBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(captionBox.x + captionBox.width / 2 + 10, captionBox.y + captionBox.height / 2 - 20, { steps: 4 });
      await page.mouse.up();
      if (captionBefore === await caption.evaluate(element => element.style.top)) throw new Error(`Caption did not move at ${viewport.width}px`);
      if (viewport.width === 390) {
        const resized = await caption.boundingBox();
        const x = resized.x + resized.width / 2, y = resized.y + resized.height / 2;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 10, y, id: 1 }, { x: x + 10, y, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 25, y, id: 1 }, { x: x + 25, y, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForTimeout(200);
      if (!saved?.draft?.hook_placement || saved.draft.hook_placement.scale <= 1) throw new Error('Mouse resize was not saved');
      if (!saved?.draft?.caption_placement || (viewport.width === 390 && saved.draft.caption_placement.scale <= 1)) throw new Error('Touch resize was not saved');
      if (viewport.width === 390) await page.screenshot({ path: 'C:/Users/Michael/Documents/Codex/2026-10-22/a/editor-preview/direct-text-drag-mobile.png' });
      console.log(`PASS direct hook and caption drag in Transcript tool at ${viewport.width}px`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
