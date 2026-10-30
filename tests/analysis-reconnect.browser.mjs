/** Local browser contract smoke with mocked routes; no network or provider calls. */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const jobs = new Map();
let transcriptionCalls = 0;
let aiCalls = 0;
let sparksCharges = 0;
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.route("https://klyp.test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Klyp recovery test</title><main>Local analysis test</main>" });
      return;
    }
    if (path.startsWith("/jobs/")) {
      const job = jobs.get(path.slice(6));
      await route.fulfill({ contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(job ? { status: job.status, result: job.result } : { status: "missing" }) });
      return;
    }
    if (path !== "/analyze" || request.method() !== "POST") { await route.fulfill({ status: 404 }); return; }
    const { jobId } = JSON.parse(request.postData());
    let job = jobs.get(jobId);
    if (!job) {
      job = { status: "running", transcript: null, result: null };
      jobs.set(jobId, job);
      setTimeout(() => {
        if (!job.transcript) { transcriptionCalls++; job.transcript = ["hello"]; }
        aiCalls++;
        sparksCharges++;
        job.result = { type: "result", clips: [{ title: "Moment" }], sparksSpent: 38 };
        job.status = "completed";
      }, 150);
    }
    await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "job", jobId })}\n\n` });
  });
  await page.goto("https://klyp.test/");
  const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const disconnected = await page.evaluate(async (id) => {
    const abort = new AbortController();
    const res = await fetch("/analyze", { method: "POST", body: JSON.stringify({ jobId: id }), signal: abort.signal });
    const reader = res.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    abort.abort();
    return first.includes(id);
  }, jobId);
  assert.equal(disconnected, true);
  await page.reload();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const recovered = await page.evaluate(async (id) => (await (await fetch(`/jobs/${id}`, { cache: "no-store" })).json()).result, jobId);
  assert.equal(recovered.clips[0].title, "Moment");
  await page.evaluate(async (id) => { const res = await fetch("/analyze", { method: "POST", body: JSON.stringify({ jobId: id }) }); await res.body.cancel(); }, jobId);
  assert.equal(transcriptionCalls, 1);
  assert.equal(aiCalls, 1);
  assert.equal(sparksCharges, 1);
  console.log("PASS: browser reload, result retrieval and duplicate request (mocked local routes)");
} finally { await browser?.close(); }
