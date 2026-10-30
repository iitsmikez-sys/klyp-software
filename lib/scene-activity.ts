import { spawn } from 'node:child_process';
import { resolveBin } from './bin.ts';
import type { ActivityPoint } from './vod-candidates';

/** Parse FFmpeg showinfo positions; these remain candidate signals, not clips. */
export function parseSceneTimes(output: string, vodOffsetSeconds: number): ActivityPoint[] {
  const points: ActivityPoint[] = [];
  for (const line of output.split('\n')) {
    const match = /pts_time:\s*([0-9.]+)/.exec(line);
    if (match && line.includes('showinfo')) points.push({ seconds: vodOffsetSeconds + Number(match[1]), strength: 1 });
  }
  return points;
}

/** Inspect only selected low-resolution footage; a scene cut cannot approve a clip. */
export async function scanSceneChanges(file: string, relativeStart: number, duration: number, vodStart: number): Promise<ActivityPoint[]> {
  const child = spawn(resolveBin('ffmpeg'), [
    '-v', 'info', '-ss', String(relativeStart), '-i', file, '-t', String(duration), '-an',
    '-vf', "fps=2,scale=320:-1,select='gt(scene,0.4)',showinfo", '-f', 'null', '-',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let output = '';
  child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-100_000); });
  const timeout = setTimeout(() => child.kill(), 40_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (code !== 0) throw new Error(`scene scan failed (ffmpeg exit ${code})`);
    return parseSceneTimes(output, vodStart);
  } finally { clearTimeout(timeout); }
}
