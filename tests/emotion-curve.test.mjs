import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emotionCurve, pickPitchCandidates, findEmotionPeaks, formatEmotionPeaksForPrompt, MIN_PEAK_STRENGTH } from "../lib/emotion-curve.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll(String.fromCharCode(13), "");

/** Loudness readings every 100 ms: a steady level with a little wobble, plus louder stretches given as [from, to, level]. */
function samples(seconds, base = -30, bursts = []) {
  const out = [];
  for (let i = 0; i < seconds * 10; i++) {
    const t = i / 10; let m = base + Math.sin(i / 7) * 0.8;
    for (const [from, to, level] of bursts) if (t >= from && t < to) m = level;
    out.push({ t, m });
  }
  return out;
}
const word = (text, second) => ({ text, start: second * 1000, end: second * 1000 + 300 });
const talk = (from, to) => { const out = []; for (let s = from; s < to; s++) out.push(word("so", s), word("then", s + 0.4)); return out; };

test("flat audio and ordinary talking have no emotion peaks", () => {
  const curve = emotionCurve({ samples: samples(600), words: talk(0, 600) });
  assert.deepEqual(findEmotionPeaks(curve, "gaming", 600), []);
  assert.deepEqual(findEmotionPeaks(curve, "irl", 600), []);
});

test("too little audio gives no curve at all", () => {
  assert.equal(emotionCurve({ samples: samples(3), words: [] }), null);
  assert.equal(emotionCurve({ samples: samples(100, -75), words: [] }), null, "pure silence");
});

test("a loud burst with a reaction in speech and a chat spike is the top peak, with the evidence listed", () => {
  const input = { samples: samples(600, -30, [[300, 304, -14]]), words: [...talk(0, 295), word("no", 301), word("way", 301.4), word("oh", 302), word("my", 302.2), word("god", 302.5)], chatSpikes: [{ seconds: 312, intensity: 6 }] };
  const peaks = findEmotionPeaks(emotionCurve(input), "gaming", 600);
  assert.ok(peaks.length >= 1);
  const top = peaks[0];
  assert.ok(top.peak_seconds >= 298 && top.peak_seconds <= 305, String(top.peak_seconds));
  assert.ok(top.strength >= 70, String(top.strength));
  assert.ok(top.start_seconds < top.peak_seconds && top.end_seconds > top.peak_seconds);
  const text = top.evidence.join(" | ");
  assert.match(text, /volume \d+ dB above the nearby level/);
  assert.match(text, /reaction phrase/);
  assert.match(text, /chat spike/);
  assert.ok(["shock", "hype"].includes(top.feeling), top.feeling);
});

test("more kinds of evidence make a stronger peak than volume alone", () => {
  const loud = samples(600, -30, [[300, 304, -10]]);
  const volumeOnly = findEmotionPeaks(emotionCurve({ samples: loud, words: talk(0, 600) }), "gaming", 600)[0];
  const everything = findEmotionPeaks(emotionCurve({ samples: loud, words: [...talk(0, 299), word("no", 301), word("way", 301.4), word("lmao", 302)], chatSpikes: [{ seconds: 311, intensity: 7 }] }), "gaming", 600)[0];
  assert.ok(volumeOnly.strength >= MIN_PEAK_STRENGTH);
  assert.ok(everything.strength > volumeOnly.strength, `${everything.strength} vs ${volumeOnly.strength}`);
});

test("laughing and angry words give their own feeling", () => {
  const loud = samples(600, -30, [[200, 203, -20], [400, 403, -20]]);
  const laugh = findEmotionPeaks(emotionCurve({ samples: loud, words: [...talk(0, 199), word("hahaha", 201), word("lmao", 201.5), word("lol", 202)] }), "irl", 600);
  assert.equal(laugh.find((p) => Math.abs(p.peak_seconds - 201) <= 3)?.feeling, "laughter");
  const anger = findEmotionPeaks(emotionCurve({ samples: loud, words: [...talk(0, 399), word("what", 401), word("the", 401.2), word("fuck", 401.5), word("damn", 402), word("shit", 402.4)] }), "irl", 600);
  assert.equal(anger.find((p) => Math.abs(p.peak_seconds - 401) <= 3)?.feeling, "anger");
});

test("a noisy stretch does not hide a real burst in a calm one: loudness is judged against the nearby level", () => {
  // The first 400 seconds are loud all the time (a busy street), then it gets calm and a burst happens.
  const loudStreet = samples(400, -15), calm = samples(400, -40).map((s) => ({ t: s.t + 400, m: s.m }));
  const burst = [...loudStreet, ...calm].map((s) => (s.t >= 650 && s.t < 654 ? { ...s, m: -16 } : s));
  const peaks = findEmotionPeaks(emotionCurve({ samples: burst, words: talk(0, 800) }), "irl", 800);
  assert.ok(peaks.some((p) => p.peak_seconds >= 648 && p.peak_seconds <= 656), "the burst in the calm part is found");
  assert.ok(!peaks.some((p) => p.peak_seconds < 390), "the always-loud street produces no peaks");
});

test("a burst right after quiet counts for extra", () => {
  const quiet = samples(600, -30, [[290, 300, -45], [300, 303, -18]]);
  const peak = findEmotionPeaks(emotionCurve({ samples: quiet, words: talk(0, 600) }), "gaming", 600)[0];
  assert.match(peak.evidence.join(" "), /burst right after quiet/);
});

test("a rise in the voice's pitch adds evidence and strength", () => {
  const input = { samples: samples(600, -30, [[300, 304, -11]]), words: talk(0, 600) };
  const curve = emotionCurve(input);
  const without = findEmotionPeaks(curve, "gaming", 600)[0];
  const withPitch = findEmotionPeaks(curve, "gaming", 600, new Map([[301, 1.55]]))[0];
  assert.ok(withPitch.strength > without.strength);
  assert.match(withPitch.evidence.join(" "), /voice pitch 55% higher than just before/);
});

test("Gaming leans on the voice and IRL on volume: the same loud burst scores higher in IRL", () => {
  const curve = emotionCurve({ samples: samples(600, -30, [[300, 304, -9]]), words: talk(0, 600) });
  assert.ok(findEmotionPeaks(curve, "irl", 600)[0].strength > findEmotionPeaks(curve, "gaming", 600)[0].strength);
});

test("the voice-pitch check is only run on the strongest, well spread out moments", () => {
  const curve = emotionCurve({ samples: samples(900, -30, [[100, 103, -10], [300, 303, -9], [305, 308, -9], [600, 603, -11]]), words: talk(0, 900) });
  const picked = pickPitchCandidates(curve, "gaming", 24);
  assert.ok(picked.length >= 3 && picked.length <= 24);
  for (let i = 1; i < picked.length; i++) assert.ok(picked[i] - picked[i - 1] >= 10);
  assert.ok(picked.some((s) => Math.abs(s - 301) <= 3));
});

test("peaks are strongest first, spread apart, and limited in number", () => {
  const bursts = Array.from({ length: 40 }, (_, i) => [60 + i * 40, 63 + i * 40, -9]);
  const curve = emotionCurve({ samples: samples(1800, -30, bursts), words: talk(0, 1800) });
  const peaks = findEmotionPeaks(curve, "gaming", 1800);
  assert.ok(peaks.length <= 20 && peaks.length >= 6);
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i - 1].strength >= peaks[i].strength);
  const seconds = peaks.map((p) => p.peak_seconds).sort((a, b) => a - b);
  for (let i = 1; i < seconds.length; i++) assert.ok(seconds[i] - seconds[i - 1] >= 10);
});

test("the prompt section lists times, strength, feeling and evidence, and warns what to trust", () => {
  const input = { samples: samples(4000, -30, [[3700, 3704, -14]]), words: [...talk(0, 3699), word("no", 3701), word("way", 3701.4)], chatSpikes: [{ seconds: 3712, intensity: 6 }] };
  const peaks = findEmotionPeaks(emotionCurve(input), "gaming", 4000);
  const gaming = formatEmotionPeaksForPrompt(peaks, "gaming");
  assert.match(gaming, /## EMOTION PEAKS/);
  assert.match(gaming, /1:01:4\d \(about 1:01:3\d to 1:01:\d+\): strength \d+\/100, likely/);
  assert.match(gaming, /Evidence: volume/);
  assert.match(gaming, /Game audio is loud by itself/);
  assert.match(gaming, /5-15 seconds BEFORE the peak/);
  assert.match(gaming, /Never return a clip only because a number was high/);
  const irl = formatEmotionPeaksForPrompt(peaks, "irl");
  assert.match(irl, /Streets, crowds and music are loud too/);
  assert.doesNotMatch(irl, /Game audio is loud by itself/);
  assert.equal(formatEmotionPeaksForPrompt([], "irl"), "");
});

test("the pipeline measures loudness for Gaming and IRL, builds the curve and peaks, and gives them to the prompt", () => {
  const pipeline = read("lib/analyze-pipeline.ts");
  // Loudness runs for every content type; only Gaming keeps using the loud stretches as hints.
  assert.match(pipeline, /emotionAudioPath = audioPath;\s*const measured = await withMem\("loud-moments", \(\) => detectLoudMoments\(audioPath, \{/);
  assert.match(pipeline, /onSamples: \(samples\) => \{ loudSamples = samples; \}/);
  assert.match(pipeline, /if \(contentType === "gaming"\) \{\s*loudMoments = measured;/);
  // The curve needs the words and chat, then the pitch check and the peaks, and a failure never fails the analysis.
  assert.match(pipeline, /await import\("@\/lib\/emotion-curve"\)/);
  assert.match(pipeline, /await import\("@\/lib\/voice-pitch"\)/);
  assert.match(pipeline, /emotionCurve\(\{ samples: loudSamples, words, chatSpikes \}\)/);
  assert.match(pipeline, /findEmotionPeaks\(curve, emotionContent, durationSeconds, pitchRatios\)/);
  assert.match(pipeline, /emotion curve failed \(no emotion hints\)/);
  // The prompt gets the section for both types, and results made with it are cached apart.
  assert.match(pipeline, /\$\{loudSection\}\$\{emotionSection\}/);
  assert.match(pipeline, /emotionSection \? "emo-v1" : ""/);
  assert.match(pipeline, /loudMoments, quietStream, nonEnglish, emotionSection\)\);/);
});
