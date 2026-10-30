const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto('http://localhost:3133/dashboard/clips/00000000-0000-0000-0000-000000000001/edit');
    await page.locator('video').waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.evaluate(() => {
      const video = document.querySelector('video');
      window.__audioProbe = { seeks: [], samples: [], pauses: 0 };
      video.addEventListener('seeking', () => window.__audioProbe.seeks.push(video.currentTime));
      video.addEventListener('pause', () => window.__audioProbe.pauses++);
      const sample = () => {
        if (!video.paused) window.__audioProbe.samples.push(video.currentTime);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(5000);
    const result = await page.evaluate(() => {
      const video = document.querySelector('video');
      const samples = window.__audioProbe.samples;
      const backwards = samples.slice(1).map((time, index) => time - samples[index]).filter(delta => delta < -0.05);
      return { seekCount: window.__audioProbe.seeks.length, seekTargets: window.__audioProbe.seeks.slice(0, 5), backwards, pauses: window.__audioProbe.pauses, first: samples[0], last: samples.at(-1), videos: [...document.querySelectorAll('video')].map(v => ({ muted: v.muted, paused: v.paused, currentTime: v.currentTime, volume: v.volume })), playbackRate: video.playbackRate };
    });
    console.log(JSON.stringify(result));
    if (result.seekCount > 3) throw new Error(`Preview repeatedly sought ${result.seekCount} times during five seconds of normal playback`);
    if (result.backwards.length) throw new Error('Preview playback moved backwards');
    if (result.videos.filter(video => !video.muted && !video.paused).length !== 1) throw new Error('Expected exactly one audible video player');
    const scrubber = page.getByLabel('Playhead position');
    await scrubber.scrollIntoViewIfNeeded();
    const rect = await scrubber.boundingBox();
    await page.mouse.click(rect.x + rect.width * 12 / 18, rect.y + rect.height / 2);
    await page.waitForTimeout(300);
    const seekedTime = await page.locator('video').evaluate(video => video.currentTime);
    if (seekedTime < 11 || seekedTime > 13) throw new Error(`Deliberate timeline seek landed at ${seekedTime}s instead of 12s`);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    console.log(`PASS continuous audio playback and explicit timeline seek to ${seekedTime.toFixed(2)}s`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
