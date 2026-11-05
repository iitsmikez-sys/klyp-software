import test from "node:test";
import assert from "node:assert/strict";
import { estimatePitchHz, medianPitchHz, pitchRatio, pcmToFloat, measurePitchRatios, PITCH_SAMPLE_RATE } from "../lib/voice-pitch.ts";

const SR = PITCH_SAMPLE_RATE;
/** A voice-like tone: the base pitch plus a few harmonics. */
const tone = (hz, seconds, amp = 0.3) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) =>
  amp * (Math.sin(2 * Math.PI * hz * i / SR) + 0.5 * Math.sin(4 * Math.PI * hz * i / SR) + 0.25 * Math.sin(6 * Math.PI * hz * i / SR)) / 1.75);
const noise = (seconds, amp = 0.3) => { let seed = 12345; return Float32Array.from({ length: Math.round(seconds * SR) }, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return amp * ((seed / 0x7fffffff) * 2 - 1); }); };
const silence = (seconds) => new Float32Array(Math.round(seconds * SR));
const toPcmBytes = (floats) => { const bytes = new Uint8Array(floats.length * 2); const view = new DataView(bytes.buffer); floats.forEach((v, i) => view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true)); return bytes; };
const join = (...parts) => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

test("the pitch of a voice-like tone is found within a few percent", () => {
  for (const hz of [110, 150, 200, 260, 300, 380]) {
    const found = estimatePitchHz(tone(hz, 0.1).subarray(0, 512));
    assert.ok(found !== null && Math.abs(found - hz) / hz < 0.04, `${hz} -> ${found}`);
  }
});

test("silence and plain noise are not mistaken for a voice", () => {
  assert.equal(estimatePitchHz(silence(0.1).subarray(0, 512)), null);
  assert.equal(estimatePitchHz(noise(0.1).subarray(0, 512)), null);
  assert.equal(estimatePitchHz(tone(200, 0.01)), null, "a frame that is too short");
  assert.equal(medianPitchHz(noise(1)), null);
  assert.equal(medianPitchHz(silence(1)), null);
});

test("the typical pitch of a second of speech, and how much higher a reaction is than the calm before it", () => {
  const calm = medianPitchHz(tone(200, 1));
  assert.ok(Math.abs(calm - 200) / 200 < 0.04, String(calm));
  const ratio = pitchRatio(tone(200, 3), tone(300, 3));
  assert.ok(ratio > 1.4 && ratio < 1.6, String(ratio));
  assert.ok(pitchRatio(tone(200, 3), tone(200, 3)) < 1.05);
  assert.equal(pitchRatio(tone(200, 3), silence(3)), null, "no ratio when one side is not a voice");
});

test("16-bit audio bytes are read back as the same waveform", () => {
  const original = tone(200, 0.2);
  const back = pcmToFloat(toPcmBytes(original));
  assert.equal(back.length, original.length);
  assert.ok(Math.abs(back[100] - original[100]) < 0.001);
});

test("measuring the moments: a voice that rises gets a ratio, an unclear one is left out, a failing one is skipped", async () => {
  // 12 seconds around a moment: 5 calm seconds at 200 Hz, then 2 quiet, then 5 seconds at 300 Hz.
  const rising = toPcmBytes(join(tone(200, 5), silence(2), tone(300, 5)));
  const flatNoise = toPcmBytes(noise(12));
  const calls = [];
  const deps = {
    ffmpeg: "ffmpeg", tempPath: (i) => `/tmp/pitch-${i}.raw`,
    run: async (bin, args) => { calls.push(args); if (args.includes("/tmp/pitch-2.raw")) throw new Error("ffmpeg failed"); },
    readBytes: async (path) => (path.endsWith("-1.raw") ? flatNoise : rising),
  };
  const ratios = await measurePitchRatios("audio.mp3", [100, 200, 300], deps, 2);
  assert.ok(ratios.get(100) > 1.4 && ratios.get(100) < 1.6, String(ratios.get(100)));
  assert.equal(ratios.has(200), false, "noise is not a voice");
  assert.equal(ratios.has(300), false, "a failed read is skipped, not fatal");
  assert.equal(calls.length, 3);
  // Each read is a short window ending a few seconds after the moment, at the low sample rate.
  const first = calls.find((a) => a.includes("/tmp/pitch-0.raw"));
  assert.equal(first[first.indexOf("-ss") + 1], "91");
  assert.equal(first[first.indexOf("-t") + 1], "12");
  assert.equal(first[first.indexOf("-ar") + 1], "8000");
});
