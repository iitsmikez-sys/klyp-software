import { spawn } from 'node:child_process';
import { resolveBin } from './bin.ts';
import { activityFromEnergyFrames, type EnergyFrame } from './audio-activity.ts';
import type { ActivityPoint } from './vod-candidates';

/** Scan speech-band energy at 1-second resolution without paid transcription. */
export async function scanAudioActivity(audioPath: string): Promise<ActivityPoint[]> {
  const child = spawn(resolveBin('ffmpeg'), [
    '-v', 'error', '-i', audioPath, '-vn', '-af', 'highpass=f=150,lowpass=f=850',
    '-ac', '1', '-ar', '2000', '-f', 's16le', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const frames: EnergyFrame[] = [];
  let pending = Buffer.alloc(0);
  let errorText = '';
  const completion = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const timer = setTimeout(() => child.kill(), 30 * 60_000);
  child.stderr.on('data', (chunk: Buffer) => { errorText = (errorText + chunk.toString()).slice(-4000); });
  try {
    for await (const chunk of child.stdout) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4000) {
        let squares = 0;
        for (let i = 0; i < 4000; i += 2) {
          const sample = pending.readInt16LE(i);
          squares += sample * sample;
        }
        frames.push({ seconds: frames.length, rms: Math.sqrt(squares / 2000) });
        pending = pending.subarray(4000);
      }
    }
    const code = await completion;
    if (code !== 0) throw new Error(`audio activity scan failed: ${errorText || `ffmpeg exit ${code}`}`);
    return activityFromEnergyFrames(frames);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
  }
}
