import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { locateUploadedFile, uploadDirectory } from "../lib/upload-location.ts";

test("unfinished upload remains discoverable after worker state is discarded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "klyp-upload-recovery-"));
  const cache = path.join(root, "cache");
  const volume = path.join(root, "volume");
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  try {
    await mkdir(volume);
    const file = path.join(volume, `upload-${id}.mp4`);
    await writeFile(file, "local test asset");
    const firstWorker = uploadDirectory(cache, volume);
    assert.equal(await locateUploadedFile(id, [firstWorker, cache]), file);
    // New module state / worker process uses only the configured volume path.
    const restartedWorker = uploadDirectory(cache, volume);
    assert.equal(await locateUploadedFile(id, [restartedWorker, cache]), file);
    assert.equal(await locateUploadedFile("../other", [volume]), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("existing temp uploads remain readable when persistent storage is first enabled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "klyp-upload-legacy-"));
  const cache = path.join(root, "cache");
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  try {
    await mkdir(cache);
    const file = path.join(cache, `upload-${id}.mov`);
    await writeFile(file, "legacy test asset");
    assert.equal(await locateUploadedFile(id, [path.join(root, "volume"), cache]), file);
  } finally { await rm(root, { recursive: true, force: true }); }
});
