import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanAudioActivity } from '../lib/audio-scan.ts';

test('local audio scan discovers an onset without transcription or a model call', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'klyp-audio-scan-'));
  try {
    const samples = 20 * 2000;
    const pcm = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const loud = i >= 15 * 2000 && i < 18 * 2000;
      pcm.writeInt16LE(loud ? Math.round(12000 * Math.sin(2 * Math.PI * 400 * i / 2000)) : 0, i * 2);
    }
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(2000, 24); header.writeUInt32LE(4000, 28);
    header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const file = path.join(dir, 'sound.wav');
    await writeFile(file, Buffer.concat([header, pcm]));
    const points = await scanAudioActivity(file);
    assert.ok(points.some(p => p.seconds >= 15 && p.seconds <= 18));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
