import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });

  const videos = page.locator("video[data-demo]");
  assert.equal(await videos.count(), 4, "the homepage should show one playable source and three clips");
  assert.ok(await page.getByText("Illustrative sample footage", { exact: false }).isVisible());
  assert.ok(await page.getByText("BIG REACTION", { exact: true }).isVisible());
  const flowBarWidth = await page.locator(".eq-bar").first().evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(flowBarWidth > 1, "the analysis icon bars should be visible");

  for (let index = 0; index < 4; index += 1) {
    const video = videos.nth(index);
    const media = await video.evaluate(async (element) => {
      if (element.readyState < 1) {
        await new Promise((resolve, reject) => {
          element.addEventListener("loadedmetadata", resolve, { once: true });
          element.addEventListener("error", reject, { once: true });
        });
      }
      return {
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight,
        posterLoaded: await new Promise((resolve) => {
          const image = new Image();
          image.onload = () => resolve(true);
          image.onerror = () => resolve(false);
          image.src = element.poster;
        }),
      };
    });

    assert.ok(media.duration > 0, `video ${index} should load`);
    assert.ok(media.posterLoaded, `poster ${index} should load`);
    if (index === 0) assert.ok(media.width > media.height, "the source should be landscape");
    else assert.ok(media.height > media.width, `clip ${index} should be vertical`);
  }

  await videos.first().evaluate((element) => element.play());
  await page.waitForFunction(() => document.querySelector("video[data-demo]").currentTime > 0.1);

  await page.getByRole("button", { name: "Play Example clip one" }).click();
  await page.waitForFunction(() => {
    const clips = document.querySelectorAll("video[data-demo]");
    return clips[0].paused && !clips[1].paused;
  });

  await page.getByRole("button", { name: "Play Example clip two" }).click();
  await page.waitForFunction(() => {
    const clips = document.querySelectorAll("video[data-demo]");
    return clips[1].paused && !clips[2].paused;
  });

  console.log("Homepage demo: source and three clips loaded and play one at a time; all posters loaded.");
} finally {
  await browser.close();
}
