import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderKeptSegments } from '../lib/editor-render.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'klyp-voice-'));
try {
  const source = path.join(dir, 'source.mp4');
  const output = path.join(dir, 'polished.mp4');
  const make = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=3', '-f', 'lavfi', '-i', 'sine=frequency=350:duration=3', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', '-y', source], { encoding: 'utf8' });
  if (make.status !== 0) throw new Error(make.stderr);
  const result = await renderKeptSegments(source, 0, [{ id: 'one', start_seconds: 0, end_seconds: 1 }, { id: 'two', start_seconds: 2, end_seconds: 3 }], output, 'voice');
  if (!result.hasAudio || result.duration !== 2 || statSync(output).size < 1000) throw new Error('Invalid polished render');
  console.log('PASS: voice polish rendered two joined segments with audio');
} finally { rmSync(dir, { recursive: true, force: true }); }
