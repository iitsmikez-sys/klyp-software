import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitSegment, deleteSegment } from "../lib/edit-segments.ts";
import { buildEditorMediaFilter } from "../lib/editor-media-render.ts";
import { retimeWordsWithMedia, buildEditorTimeline } from "../lib/editor-media.ts";
import { parseEditedWords } from "../lib/editor-captions.ts";
import { generateAss, generateHookAss, toFfmpegPath } from "../lib/captions.ts";

test("trim, split, delete, import, edit captions, and render one playable clip", () => {
  const dir = mkdtempSync(join(tmpdir(), "klyp-editor-all-"));
  try {
    const source = join(dir, "source.mp4");
    const image = join(dir, "image.jpg");
    const output = join(dir, "output.mp4");
    const captions = join(dir, "captions.ass");
    const hook = join(dir, "hook.ass");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=4",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-c:a", "aac", source]);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:size=160x90",
      "-frames:v", "1", image]);

    // Step 2 trims; step 3 splits and removes the middle; step 4 inserts a photo.
    const trimmed = [{ start: 1, end: 4 }];
    const split = splitSegment(splitSegment(trimmed, 0, 2), 1, 3);
    const kept = deleteSegment(split, 1);
    assert.deepEqual(kept, [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
    const media = [{ id: "11111111-1111-4111-8111-111111111111", kind: "image", after: 0, duration: 1 }];
    assert.equal(buildEditorTimeline(kept, media).at(-1).end, 3);

    // Step 5 changes the text while preserving source timestamps, then burns style and hook.
    const original = [{ text: "first", start: 1200, end: 1600 }, { text: "last", start: 3200, end: 3600 }];
    const edited = parseEditedWords([{ text: "HELLO" }, { text: "WORLD" }], original);
    const outputWords = retimeWordsWithMedia(edited, 0, kept, media);
    assert.deepEqual(outputWords.map((word) => word.start), [200, 2200]);
    writeFileSync(captions, generateAss(outputWords, 0, 3000, "BOLD", { w: 160, h: 90 },
      { color: "YELLOW", position: "CENTER" }));
    writeFileSync(hook, generateHookAss("BEST MOMENT", { w: 160, h: 90 }, "IMPACT"));
    const postFilter = `subtitles='${toFfmpegPath(captions)}',subtitles='${toFfmpegPath(hook)}'`;
    const { graph, videoLabel, audioLabel } = buildEditorMediaFilter(kept, media, true, [false], 160, 90, postFilter);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source,
      "-loop", "1", "-framerate", "30", "-t", "1", "-i", image,
      "-filter_complex", graph, "-map", videoLabel, "-map", audioLabel,
      "-c:v", "libx264", "-c:a", "aac", output]);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type",
      "-of", "json", output], { encoding: "utf8" }));
    assert.ok(Number(probe.format.duration) > 2.9 && Number(probe.format.duration) < 3.1);
    assert.deepEqual(probe.streams.map((stream) => stream.codec_type).sort(), ["audio", "video"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
