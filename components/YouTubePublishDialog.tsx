'use client';

import { useEffect, useState } from 'react';
import { processingFetch } from '@/lib/processing-api';

type PreviousPost = { id: string; clip_id: string; status: string; youtube_video_id: string | null;
  title: string; publish_at: string | null; canRetry: boolean };
type Status = { connected: boolean; proRequired?: boolean; posts?: PreviousPost[]; error?: string };

export default function YouTubePublishDialog({ clipId, clipTitle, pro, makePayload, onClose }: {
  clipId: string;
  clipTitle: string;
  pro: boolean;
  makePayload: () => Record<string, unknown>;
  onClose: () => void;
}) {
  const [connection, setConnection] = useState<Status | null>(null);
  const [title, setTitle] = useState(clipTitle.slice(0, 100));
  const [description, setDescription] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; youtubeUrl: string; publishAt: string } | null>(null);
  const [reload, setReload] = useState(0);
  const previous = connection?.posts?.find(post => post.clip_id === clipId);
  const scheduledDate = scheduledLocal ? new Date(scheduledLocal) : null;
  const validSchedule = !!scheduledDate && Number.isFinite(scheduledDate.getTime()) &&
    scheduledDate.getTime() >= Date.now() + 30 * 60_000;
  const scheduleLabel = validSchedule && scheduledDate
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(scheduledDate)
    : null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    let active = true;
    fetch(`/api/youtube/status?clip_id=${encodeURIComponent(clipId)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Could not check YouTube connection.');
        return data as Status;
      })
      .then(data => { if (active) {
        setConnection(data);
        if (data.posts?.some(post => post.status === 'failed')) localStorage.removeItem(`klyp.youtube.publish.${clipId}`);
      } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Connection check failed.'); });
    return () => { active = false; };
  }, [clipId, reload]);

  async function submit() {
    if (busy) return;
    setError(null);
    if (!validSchedule || !scheduledDate) {
      setError('Choose a date and time at least 30 minutes from now.');
      return;
    }
    const publishAt = scheduledDate.toISOString();
    let clipPayload: Record<string, unknown>;
    try { clipPayload = makePayload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Check your clip edits.'); return; }
    setBusy(true);
    try {
      const keyName = `klyp.youtube.publish.${clipId}`;
      let requestKey = localStorage.getItem(keyName);
      if (!requestKey) {
        requestKey = crypto.randomUUID();
        localStorage.setItem(keyName, requestKey);
      }
      const response = await processingFetch('/api/youtube/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestKey, clipPayload, title, description, publishAt, privacyStatus: 'public' }),
      });
      const data = await response.json();
      if (data.status === 'failed') localStorage.removeItem(keyName);
      if (!response.ok) throw new Error(data.error ?? 'YouTube publishing failed.');
      if (data.youtubeUrl) {
        setResult({ status: data.status, youtubeUrl: data.youtubeUrl, publishAt });
        localStorage.removeItem(keyName);
      } else setError(data.status === 'needs_review'
        ? 'The upload outcome is uncertain. Check your YouTube channel before trying again.'
        : data.status === 'failed' ? 'The upload failed before YouTube received it. You can try again.'
          : 'This post is still processing. Check your YouTube channel before trying again.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'YouTube publishing failed. Check your channel before retrying.');
    } finally { setBusy(false); }
  }

  async function clearUncertainPost() {
    if (!previous?.canRetry || !window.confirm('Check your YouTube channel first. Continue only if this video is not there.')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/youtube/resolve', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: previous.id, confirmNoUpload: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not prepare a retry.');
      localStorage.removeItem(`klyp.youtube.publish.${clipId}`);
      setConnection(current => current ? { ...current,
        posts: current.posts?.filter(post => post.id !== previous.id) } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare a retry.'); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    if (busy || !window.confirm('Disconnect this YouTube account from Klyp? Scheduled videos already accepted by YouTube will remain scheduled.')) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/youtube/disconnect', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not disconnect YouTube.');
      setConnection(current => current ? { ...current, connected: false } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not disconnect YouTube.'); }
    finally { setBusy(false); }
  }

  return <div className="youtube-dialog-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section className="youtube-dialog" role="dialog" aria-modal="true" aria-labelledby="youtube-dialog-title">
      <header><div><p>Pro publishing</p><h2 id="youtube-dialog-title">Schedule for YouTube</h2></div>
        <button type="button" aria-label="Close YouTube publishing" disabled={busy} onClick={onClose}>×</button></header>
      {!pro || connection?.proRequired ? <div className="youtube-dialog-body"><p>YouTube publishing is included with an active Pro subscription.</p>
        <a className="youtube-dialog-primary" href="/dashboard/upgrade">View Pro</a></div>
      : !connection ? <div className="youtube-dialog-body"><p>{error ? 'Could not check your YouTube connection.' : 'Checking your YouTube connection…'}</p>
        {error && <button type="button" onClick={() => { setError(null); setReload(value => value + 1); }}>Try again</button>}
        </div>
      : !connection.connected ? <div className="youtube-dialog-body"><p>Connect the YouTube channel where you want to post your finished clip. <a href="/privacy" target="_blank" rel="noopener noreferrer">How Klyp uses YouTube access</a></p>
        <a className="youtube-dialog-primary" href={`/api/youtube/connect?clip_id=${encodeURIComponent(clipId)}`}>Connect YouTube</a></div>
      : result ? <div className="youtube-dialog-body" role="status"><p>{result.status === 'scheduled'
          ? `YouTube received your clip. It is private until ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.publishAt))}.`
          : 'YouTube received your clip. Processing may take a few minutes.'}</p>
        <a className="youtube-dialog-primary" href={result.youtubeUrl} target="_blank" rel="noopener noreferrer">View on YouTube ↗</a></div>
      : previous?.status === 'processing' || previous?.status === 'needs_review'
        ? <div className="youtube-dialog-body" role="status"><p>{previous.status === 'processing'
          ? 'An upload for this clip is still processing. Check back shortly.'
          : 'An earlier upload needs review. Check your YouTube channel before posting this clip again.'}</p>
          {previous.youtube_video_id && <a href={`https://www.youtube.com/watch?v=${previous.youtube_video_id}`}
            target="_blank" rel="noopener noreferrer">Check the video on YouTube ↗</a>}
          {previous.canRetry && <button type="button" disabled={busy} onClick={() => void clearUncertainPost()}>
            I checked YouTube — try again</button>}
        </div>
      : previous?.youtube_video_id && (previous.status === 'uploaded' || previous.status === 'scheduled')
        ? <div className="youtube-dialog-body" role="status"><p>This clip was already sent to YouTube as “{previous.title}.”</p>
          <a className="youtube-dialog-primary" href={`https://www.youtube.com/watch?v=${previous.youtube_video_id}`} target="_blank" rel="noopener noreferrer">View on YouTube ↗</a>
          <button type="button" onClick={() => { setConnection(current => current ? { ...current,
            posts: current.posts?.filter(post => post !== previous) } : current); localStorage.removeItem(`klyp.youtube.publish.${clipId}`); }}>
            Schedule this clip again</button></div>
      : <div className="youtube-dialog-body">
        <p>Review your finished clip and choose when it should go live. Klyp uploads it privately to YouTube first.</p>
        <div className="youtube-dialog-review"><strong>Clip</strong><span>{clipTitle}</span>
          <button type="button" onClick={onClose}>Review in editor</button></div>
        <div className="youtube-dialog-review"><strong>Destination</strong><span>Your connected YouTube channel</span>
          <a href={`/api/youtube/connect?clip_id=${encodeURIComponent(clipId)}`}>Switch channel</a></div>
        <label>Video title<input maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Description<textarea maxLength={5000} rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <div className="youtube-dialog-review"><strong>Visibility</strong><span>Private until your scheduled publication time</span></div>
        <label>Publication date and time<input type="datetime-local" value={scheduledLocal}
          onChange={event => setScheduledLocal(event.target.value)} required /></label>
        <p className="youtube-dialog-timezone">Time zone: {timeZone}. Choose a time at least 30 minutes from now.</p>
        <button className="youtube-dialog-primary" type="button" disabled={busy || !title.trim() || !validSchedule} onClick={() => void submit()}>
          {busy ? 'Rendering and scheduling…' : scheduleLabel ? `Schedule for ${scheduleLabel}` : 'Choose a date and time to schedule'}
        </button>
        <small>Keep this window open until YouTube confirms the upload. Scheduling happens on YouTube after upload.</small>
        <a className="youtube-dialog-reconnect" href={`/api/youtube/connect?clip_id=${encodeURIComponent(clipId)}`}>
          YouTube connection expired? Reconnect channel</a>
      </div>}
      {error && <p className="youtube-dialog-error" role="alert">{error}
        {connection?.connected && <a href={`/api/youtube/connect?clip_id=${encodeURIComponent(clipId)}`}>
          Reconnect YouTube</a>}</p>}
      {connection?.connected && <button type="button" className="youtube-dialog-reconnect"
        disabled={busy} onClick={() => void disconnect()}>Disconnect YouTube</button>}
    </section>
  </div>;
}
