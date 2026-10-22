import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildClipArchiveAssets } from "../lib/clip-archive-assets.ts";

test("archived master, proxy, and poster survive loss of the original video", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "klyp-archive-assets-"));
  try {
    const source = path.join(dir, "source.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=3:r=12", "-f", "lavfi", "-i", "sine=duration=3", "-c:v", "libx264", "-threads", "2", "-c:a", "aac", "-y", source]);
    const assets = await buildClipArchiveAssets(source, 0, 1, 2, dir);
    await rm(source);
    for (const asset of [assets.master, assets.proxy, assets.poster]) {
      assert.ok((await stat(asset)).size > 100, `${asset} has content`);
    }
    for (const asset of [assets.master, assets.proxy]) {
      const duration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", asset], { encoding: "utf8" }).trim());
      assert.ok(duration >= 0.8 && duration <= 1.4, `clip duration ${duration}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
