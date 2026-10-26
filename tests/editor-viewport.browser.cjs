const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="clip-editor">
      <header class="editor-header"><button>Back</button><input aria-label="Clip title"><span>Saved</span><button>Export clip</button></header>
      <div class="editor-workspace"><nav class="editor-rail">Transcript</nav><aside class="editor-left-panel">Transcript</aside>
        <main class="editor-player"><div class="editor-stage"><div class="editor-canvas" style="aspect-ratio:9/16"><canvas></canvas></div></div><div class="editor-transport">Playback controls</div></main>
        <aside class="editor-inspector">Style controls</aside></div>
      <div class="editor-tools"><button>Split</button><button>Delete</button></div>
      <section class="editor-timeline"><div class="editor-timeline-heading">Timeline</div><div class="editor-track-layout"><div class="editor-track-labels"><p>Video</p><p>Captions</p><p>Audio</p><p>Hook</p></div><div class="editor-track-scroll"><div class="editor-ruler"></div><div class="editor-lane"></div><div class="editor-lane"></div><div class="editor-lane"></div><div class="editor-lane"></div></div></div></section>
    </div>`);
    await page.addStyleTag({ content: fs.readFileSync('components/clip-timeline-editor.css', 'utf8') });
    for (const { width, height } of [{ width: 1920, height: 950 }, { width: 1440, height: 800 }, { width: 1080, height: 800 }]) {
      await page.setViewportSize({ width, height });
      const boxes = await page.evaluate(() => Object.fromEntries(['.editor-canvas', '.editor-tools', '.editor-timeline'].map(selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height }];
      })));
      assert.ok(boxes['.editor-canvas'].height <= height * 0.42, `${width}x${height}: preview is ${boxes['.editor-canvas'].height}px tall`);
      assert.ok(boxes['.editor-timeline'].top < height - 100, `${width}x${height}: timeline starts below the viewport`);
      assert.ok(boxes['.editor-tools'].top < height - 150, `${width}x${height}: edit tools start below the viewport`);
      if (process.env.EDITOR_VIEWPORT_CAPTURE && width === 1920) await page.screenshot({ path: process.env.EDITOR_VIEWPORT_CAPTURE });
    }
    console.log('PASS: preview remains compact and editing controls stay visible at desktop and laptop sizes');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

