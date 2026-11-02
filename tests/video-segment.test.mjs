import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVideoSegment, hasVideoStream } from "../lib/video-segment.ts";

test("an audio-only cached segment is replaced with a video segment", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klyp-video-segment-test-"));
  try {
    const audio = path.join(dir, "audio.mp4");
    const video = path.join(dir, "video.mp4");
    const cached = path.join(dir, "cached.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-c:a", "aac", audio]);
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);

    assert.equal(await hasVideoStream(audio, "ffprobe"), false);
    assert.equal(await hasVideoStream(video, "ffprobe"), true);

    await copyFile(audio, cached);
    const attempts = [];
    await ensureVideoSegment(
      cached,
      async () => { attempts.push("primary"); await copyFile(audio, cached); },
      async () => { attempts.push("fallback"); await copyFile(video, cached); },
      (file) => hasVideoStream(file, "ffprobe")
    );
    assert.deepEqual(attempts, ["primary", "fallback"]);
    assert.equal(await hasVideoStream(cached, "ffprobe"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { isNoAudioSegmentError, videoOnlyFormat } from "../lib/video-segment.ts";

// The exact error saved for the two Twitch clips at 3:20 and 3:28 that would not back up or play.
const MUTED_SLICE_ERROR = "yt-dlp exited with code 1: ost#0:1/aac @ 0x55e51feacb80] Could not open encoder before EOF " +
  "[aost#0:1/aac @ 0x55e51feacb80] Task finished with error code: -22 (Invalid argument) " +
  "[out#0/mp4 @ 0x55e51f841e40] Nothing was written into output file, because at least one of its streams received no packets. " +
  "Conversion failed! ERROR: ffmpeg exited with code 222";

test("the muted-slice error from production is recognised as a no-audio segment", () => {
  assert.equal(isNoAudioSegmentError(new Error(MUTED_SLICE_ERROR)), true);
  assert.equal(isNoAudioSegmentError(MUTED_SLICE_ERROR), true);
});

test("other download failures are NOT treated as no-audio (they must still fail loudly)", () => {
  for (const msg of ["HTTP Error 404: Not Found", "Video unavailable", "yt-dlp stalled", "ENOSPC: no space left on device", ""])
    assert.equal(isNoAudioSegmentError(new Error(msg)), false, msg);
  assert.equal(isNoAudioSegmentError(undefined), false);
});

test("the video-only format never asks for an audio stream", () => {
  const format = videoOnlyFormat(1080);
  assert.match(format, /height<=1080/);
  assert.doesNotMatch(format, /\+ba|\bba\b|\/b\b|\[ext=m4a\]/);
});

test("a silent (video-only) segment still counts as a usable segment", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klyp-silent-segment-test-"));
  try {
    const silent = path.join(dir, "silent.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
    assert.equal(await hasVideoStream(silent, "ffprobe"), true);
    // the archive step's own encode ("-c:a aac") must accept a file with no audio track
    const out = path.join(dir, "out.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-i", silent, "-vf", "scale=-2:144", "-c:v", "libx264", "-c:a", "aac", "-b:a", "96k", "-y", out]);
    assert.equal(await hasVideoStream(out, "ffprobe"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { isTwitchVodRef } from "../lib/video-segment.ts";
test("only Twitch VOD links use the direct ffmpeg slice", () => {
  for (const ok of ["https://www.twitch.tv/videos/2561660731", "https://twitch.tv/videos/1", "https://www.twitch.tv/somestreamer/v/123"])
    assert.equal(isTwitchVodRef(ok), true, ok);
  for (const no of ["https://www.youtube.com/watch?v=abcdefghijk", "upload:abc", "https://www.twitch.tv/somestreamer", "https://example.com/videos/12"])
    assert.equal(isTwitchVodRef(no), false, no);
});
