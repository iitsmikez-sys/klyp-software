"use client";
import { useState } from 'react';
import { clampSourceRect, type NormalizedRect, type VerticalLayoutV1 } from '@/lib/vertical-layout';
import { captureFrameSamples } from '@/lib/auto-frame-client';
import { processingFetch } from '@/lib/processing-api';
import { canTransformForeground, defaultForeground, fullFrameLayout } from '@/lib/foreground-framing';

const full: VerticalLayoutV1 = { version: 1, gameplay: { x: 0, y: 0, w: 1, h: 1 } };
const centered: VerticalLayoutV1 = { version: 1, gameplay: { x: .34, y: 0, w: .32, h: 1 } };
const defaultFacecam: NormalizedRect = { x: .02, y: .02, w: .26, h: .3 };
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
  const stacked = (arrangement: 'facecam_top' | 'gameplay_top') => {
    const { foreground: _foreground, fit: _fit, ...base } = current;
    onChange({ ...base, facecam: current.facecam ?? defaultFacecam, arrangement });
  };
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
    const { foreground: _foreground, fit: _fit, ...base } = current;
    onChange({ ...base, [region]: clampSourceRect({ ...rect, [axis]: value }) });
  };
  return <section className="editor-frame-controls" aria-label="Vertical framing">
    <div className="editor-frame-heading"><div><h3>Vertical frame</h3><p>Choose a layout, then adjust what each panel shows.</p></div><span>9:16</span></div>
    <div className="editor-layout-choices" aria-label="Vertical layout presets">
      <button type="button" aria-pressed={canTransformForeground(layout) || !!layout?.fit} onClick={() => onChange(null)}><span className="layout-icon fit"><i/></span><strong>Full stream</strong><small>Adjustable size</small></button>
      <button type="button" aria-pressed={!!layout && !canTransformForeground(layout) && !layout.facecam} onClick={() => onChange(centered)}><span className="layout-icon focus"><i/></span><strong>Speaker focus</strong><small>One vertical view</small></button>
      <button type="button" aria-pressed={!!current.facecam && current.arrangement === 'facecam_top'} onClick={() => stacked('facecam_top')}><span className="layout-icon face-top"><i/><i/></span><strong>Facecam top</strong><small>Gameplay below</small></button>
      <button type="button" aria-pressed={!!current.facecam && current.arrangement !== 'facecam_top'} onClick={() => stacked('gameplay_top')}><span className="layout-icon game-top"><i/><i/></span><strong>Gameplay top</strong><small>Facecam below</small></button>
    </div>
    {canTransformForeground(layout) && <div className="editor-foreground-size"><div><label htmlFor="editor-video-size">Video size</label><output htmlFor="editor-video-size">{Math.round((current.foreground?.scale ?? 1)*100)}%</output></div><input id="editor-video-size" aria-label="Video size" type="range" min="1" max="4" step="0.01" value={current.foreground?.scale ?? 1} onChange={event=>onChange(fullFrameLayout({...(current.foreground ?? defaultForeground),scale:Number(event.target.value)}))}/><button type="button" onClick={()=>onChange(null)}>Reset framing</button><p>Drag the preview to move the video. Pinch to resize, or focus it and use + / − and arrow keys. Enlarging crops the outer edges.</p></div>}
    {current.fit && <div className="editor-frame-size"><div><strong>Video size</strong><span>{Math.round(current.fit.zoom*100)}%</span></div><input type="range" aria-label="Video size" min="1" max="4" step="0.05" value={current.fit.zoom} onChange={event=>onChange({...current,fit:{...current.fit!,zoom:Number(event.target.value)}})}/><button type="button" onClick={()=>onChange(null)}>Reset position and size</button></div>}
    {current.facecam && <div className="editor-frame-size"><div><strong>Gameplay space</strong><span>{Math.round((current.mainShare ?? (current.arrangement === 'facecam_top' ? .6 : .7))*100)}%</span></div><input type="range" aria-label="Gameplay panel size" min="0.35" max="0.8" step="0.01" value={current.mainShare ?? (current.arrangement === 'facecam_top' ? .6 : .7)} onChange={event=>onChange({...current,mainShare:Number(event.target.value)})}/><p>Change how much of the vertical frame gameplay uses.</p></div>}
    <div className="editor-frame-presets"><button type="button" onClick={suggest} disabled={!video || busy}>{busy ? 'Finding frame…' : '✦ Suggest the best crop from this clip'}</button></div>
    {message && <p role="status" className="editor-frame-message">{message}</p>}
    {proposal && <div className="editor-frame-proposal"><div className="editor-frame-proposal-head"><strong>Suggested crop</strong><button type="button" onClick={() => { onChange({ ...proposal, ...(proposal.facecam ? { arrangement: current.arrangement ?? 'facecam_top' } : {}) }); setProposal(null); setMessage('Frame applied. Adjust it below or undo.'); }}>Use this frame</button></div><div className="editor-frame-map" style={{ aspectRatio: video?.videoWidth && video?.videoHeight ? `${video.videoWidth}/${video.videoHeight}` : '16 / 9' }}><div className="editor-frame-box" style={{ left: `${proposal.gameplay.x * 100}%`, top: `${proposal.gameplay.y * 100}%`, width: `${proposal.gameplay.w * 100}%`, height: `${proposal.gameplay.h * 100}%` }}>Main</div>{proposal.facecam && <div className="editor-frame-box face" style={{ left: `${proposal.facecam.x * 100}%`, top: `${proposal.facecam.y * 100}%`, width: `${proposal.facecam.w * 100}%`, height: `${proposal.facecam.h * 100}%` }}>Facecam</div>}</div></div>}
    <div className="editor-frame-sliders">{(['gameplay', 'facecam'] as const).map(region => <div className="editor-frame-region" key={region}><div className="editor-frame-region-title"><strong>{region === 'gameplay' ? 'Main scene' : 'Facecam'}</strong>{region === 'facecam' && <label><input type="checkbox" checked={!!current.facecam} onChange={event => onChange(event.target.checked ? { version:1, gameplay:current.gameplay, facecam: defaultFacecam, arrangement: 'facecam_top' } : { version: 1, gameplay: current.gameplay })}/> Include</label>}</div>{current[region] && <div className="editor-frame-range-grid">{(['x', 'y', 'w', 'h'] as const).map(axis => <label key={axis}>{({x:'Left',y:'Top',w:'Width',h:'Height'} as const)[axis]}<input type="range" min="0" max="1" step="0.01" aria-label={`${region} ${axis}`} value={current[region]![axis]} onChange={event => update(region, axis, Number(event.target.value))}/></label>)}</div>}</div>)}</div>
  </section>;
}
