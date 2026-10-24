/** Sample the editor's already-loaded preview without moving its playhead. */
export async function captureFrameSamples(video: HTMLVideoElement): Promise<string[]> {
  const src = video.currentSrc;
  if (!src) throw new Error('Wait for the clip preview to load.');
  const probe = document.createElement('video');
  probe.preload = 'auto';
  probe.muted = true;
  probe.src = src;
  const wait = (event: string, timeout = 8000) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Could not sample this video.')); }, timeout);
    const cleanup = () => { clearTimeout(timer); probe.removeEventListener(event, ready); probe.removeEventListener('error', failed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Could not decode the preview.')); };
    probe.addEventListener(event, ready, { once: true });
    probe.addEventListener('error', failed, { once: true });
  });
  try {
    if (probe.readyState < 1) await wait('loadedmetadata');
    if (!Number.isFinite(probe.duration) || probe.duration <= 0 || !probe.videoWidth || !probe.videoHeight) throw new Error('Wait for the preview to finish loading.');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(probe.videoWidth, probe.videoHeight));
    canvas.width = Math.max(2, Math.round(probe.videoWidth * scale));
    canvas.height = Math.max(2, Math.round(probe.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not sample video frames.');
    const samples: string[] = [];
    for (const fraction of [.2, .5, .8]) {
      const seeked = wait('seeked');
      probe.currentTime = Math.max(0, Math.min(probe.duration - .05, probe.duration * fraction));
      await seeked;
      ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/jpeg', .64).split(',')[1];
      if (!data || data.length > 340_000) throw new Error('A sample frame is too large.');
      samples.push(data);
    }
    return samples;
  } finally { probe.removeAttribute('src'); probe.load(); }
}
