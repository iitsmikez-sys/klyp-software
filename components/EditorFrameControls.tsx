"use client";
import { useState } from 'react';
import { clampSourceRect, type NormalizedRect, type VerticalLayoutV1 } from '@/lib/vertical-layout';
import { captureFrameSamples } from '@/lib/auto-frame-client';
import { processingFetch } from '@/lib/processing-api';

const full: VerticalLayoutV1 = { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 } };
const centered: VerticalLayoutV1 = { version: 1, gameplay: { x: .34, y: 0, w: .32, h: 1 } };
type Region = 'gameplay' | 'facecam';

export default function EditorFrameControls({ clipId, video, layout, onChange }: {
  clipId: string;
  video: HTMLVideoElement | null;
  layout: VerticalLayoutV1 | null;
  onChange: (layout: VerticalLayoutV1 | null) => void;
}) {
  const [proposal, setProposal] = useState<VerticalLayoutV1 | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const current = layout ?? full;
  const suggest = async () => {
    if (!video || busy) return;
    setBusy(true); setMessage(null); setProposal(null);
    try {
      const frames = await captureFrameSamples(video);
      const response = await processingFetch(`/api/clips/${encodeURIComponent(clipId)}/auto-frame`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frames }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Framing suggestion failed.');
      setProposal(data.layout ?? null);
      setMessage(data.message ?? null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Framing suggestion failed.'); }
    finally { setBusy(false); }
  };
  const update = (region: Region, axis: keyof NormalizedRect, value: number) => {
    const rect = current[region] ?? { x: .7, y: 0, w: .25, h: .3 };
    onChange({ ...current, [region]: clampSourceRect({ ...rect, [axis]: value }) });
  };
  return <section className="editor-frame-controls" aria-label="Vertical framing">
    <div className="editor-frame-heading"><div><h3>Vertical frame</h3><p>Choose the part of your stream that stays in view.</p></div><span>9:16</span></div>
    <div className="editor-frame-presets"><button type="button" onClick={() => onChange(null)}>Fit full stream</button><button type="button" onClick={() => onChange(centered)}>Center subject</button><button type="button" onClick={suggest} disabled={!video || busy}>{busy ? 'Finding frame…' : '✦ Suggest frame'}</button></div>
    {message && <p role="status" className="editor-frame-message">{message}</p>}
    {proposal && <div className="editor-frame-proposal"><div className="editor-frame-proposal-head"><strong>Suggested crop</strong><button type="button" onClick={() => { onChange(proposal); setProposal(null); setMessage('Frame applied. Adjust it below or undo.'); }}>Use this frame</button></div><div className="editor-frame-map" style={{ aspectRatio: video?.videoWidth && video?.videoHeight ? `${video.videoWidth}/${video.videoHeight}` : '16 / 9' }}><div className="editor-frame-box" style={{ left: `${proposal.gameplay.x * 100}%`, top: `${proposal.gameplay.y * 100}%`, width: `${proposal.gameplay.w * 100}%`, height: `${proposal.gameplay.h * 100}%` }}>Main</div>{proposal.facecam && <div className="editor-frame-box face" style={{ left: `${proposal.facecam.x * 100}%`, top: `${proposal.facecam.y * 100}%`, width: `${proposal.facecam.w * 100}%`, height: `${proposal.facecam.h * 100}%` }}>Facecam</div>}</div></div>}
    <div className="editor-frame-sliders">{(['gameplay', 'facecam'] as const).map(region => <div className="editor-frame-region" key={region}><div className="editor-frame-region-title"><strong>{region === 'gameplay' ? 'Main scene' : 'Facecam'}</strong>{region === 'facecam' && <label><input type="checkbox" checked={!!current.facecam} onChange={event => onChange(event.target.checked ? { ...current, facecam: { x: .7, y: 0, w: .25, h: .3 } } : { version: 1, gameplay: current.gameplay })}/> Include</label>}</div>{current[region] && <div className="editor-frame-range-grid">{(['x', 'y', 'w', 'h'] as const).map(axis => <label key={axis}>{({x:'Left',y:'Top',w:'Width',h:'Height'} as const)[axis]}<input type="range" min="0" max="1" step="0.01" aria-label={`${region} ${axis}`} value={current[region]![axis]} onChange={event => update(region, axis, Number(event.target.value))}/></label>)}</div>}</div>)}</div>
  </section>;
}
