import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    assert.ok(await page.getByRole("heading", { name: "Your best moments, ready to find" }).isVisible());
    assert.ok(await page.getByRole("heading", { name: "Spend less time searching. More time posting." }).isVisible());
    assert.ok(await page.getByRole("link", { name: "Start clipping for free" }).isVisible());
    assert.equal(await page.locator("video[data-demo]").count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await page.close();
  }
  console.log("Homepage hero and revised copy render at mobile and desktop widths without demo footage or overflow.");
} finally {
  await browser.close();
}
