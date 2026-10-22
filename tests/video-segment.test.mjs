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
