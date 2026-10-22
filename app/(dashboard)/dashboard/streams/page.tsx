"use client";

/**
 * Streams — connected channels and the VODs Klyp has analyzed.
 *
 * Klyp stores clips as a source URL plus timestamps and never recorded the
 * VOD's own title, length or category, so those come from Twitch at view time
 * (/api/streams/metadata) and fall back to the VOD id when Twitch no longer
 * has the video — which is most of them, since VODs expire after a few weeks.
 *
 * Auto-clipping status is reported exactly as the backend would act on it:
 * lib/vod-poll.ts only sweeps channels with auto_clip_enabled AND a
 * twitch_user_id, so a channel added by pasting a URL is shown as not active
 * however the toggle is set.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type SavedClip, fmtDate, platformName } from "@/lib/clip-ui";
import ClipThumbnail from "@/components/ClipThumbnail";
import type { VodMeta, ChannelMeta } from "@/app/api/streams/metadata/route";

type Platform = "twitch" | "youtube" | "kick";

interface Channel {
  id: string;
  platform: Platform;
  channel_url: string;
  created_at: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  eventsub_subscription_id: string | null;
  auto_clip_enabled: boolean;
}

/** Derive the platform from a channel URL; null = unsupported. */
function channelPlatform(url: string): Platform | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return "twitch";
    if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
    if (host === "kick.com" || host.endsWith(".kick.com")) return "kick";
  } catch { /* not a URL */ }
  return null;
}

/** Channel name from a channel URL, for display and Twitch lookups. */
function channelLogin(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "").split("/").pop() || url;
  } catch {
    return url;
  }
}

/** Twitch VOD id from a clip's source URL, or null for other sources. */
function twitchVideoId(url: string): string | null {
  const m = url.match(/twitch\.tv\/videos\/(\d+)/i);
  return m ? m[1] : null;
}

function fmtLength(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const PLATFORM_STYLE: Record<Platform, { badge: string; name: string }> = {
  twitch: { badge: "bg-purple-500/15 text-purple-400 border-purple-500/30", name: "Twitch" },
  youtube: { badge: "bg-red-500/15 text-red-400 border-red-500/30", name: "YouTube" },
  kick: { badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", name: "Kick" },
};

function PlatformIcon({ platform, className = "" }: { platform: string; className?: string }) {
  if (platform === "Twitch" || platform === "twitch") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
        <path d="M4 2L2 6v14h5v2h3l2-2h3l5-5V2H4zm16 11l-3 3h-4l-2 2v-2H7V4h13v9zM15 7h2v5h-2V7zm-5 0h2v5h-2V7z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M23 12s0-4-.5-5.8a3 3 0 0 0-2.1-2.1C18.6 3.5 12 3.5 12 3.5s-6.6 0-8.4.6A3 3 0 0 0 1.5 6.2C1 8 1 12 1 12s0 4 .5 5.8a3 3 0 0 0 2.1 2.1c1.8.6 8.4.6 8.4.6s6.6 0 8.4-.6a3 3 0 0 0 2.1-2.1C23 16 23 12 23 12zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z" />
    </svg>
  );
}

/** One analyzed VOD, aggregated from its clips. */
type VodGroup = {
  url: string;
  platform: string;
  clips: SavedClip[];
  count: number;
  best: number;
  avg: number;
  latest: string;
  videoId: string | null;
};

export default function StreamsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<string>("all");
  const [vodMeta, setVodMeta] = useState<Record<string, VodMeta>>({});
  const [channelMeta, setChannelMeta] = useState<Record<string, ChannelMeta>>({});

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const [ch, cl] = await Promise.all([
      supabase.from("streams").select("*").order("created_at", { ascending: false }),
      supabase.from("clips").select("*").order("created_at", { ascending: false }),
    ]);
    setChannels((ch.data ?? []) as Channel[]);
    setClips((cl.data ?? []) as SavedClip[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Clips grouped into the VOD they came from. */
  const vods = useMemo<VodGroup[]>(() => {
    const byUrl = new Map<string, SavedClip[]>();
    for (const c of clips) {
      const list = byUrl.get(c.url) ?? [];
      list.push(c);
      byUrl.set(c.url, list);
    }
    return Array.from(byUrl.entries())
      .map(([url, list]) => {
        const scores = list.map((c) => c.viral_score);
        return {
          url,
          platform: url.startsWith("upload:") ? "Upload" : platformName(url),
          clips: [...list].sort((a, b) => b.viral_score - a.viral_score),
          count: list.length,
          best: Math.max(...scores),
          avg: Math.round(scores.reduce((s, n) => s + n, 0) / scores.length),
          latest: list.reduce((max, c) => (c.created_at > max ? c.created_at : max), list[0].created_at),
          videoId: twitchVideoId(url),
        };
      })
      .sort((a, b) => (a.latest > b.latest ? -1 : 1));
  }, [clips]);

  /* Ask Twitch for the titles, lengths and avatars Klyp never stored. */
  useEffect(() => {
    const videoIds = vods.map((v) => v.videoId).filter((id): id is string => !!id);
    const logins = channels
      .filter((c) => c.platform === "twitch")
      .map((c) => (c.twitch_login ?? channelLogin(c.channel_url)).toLowerCase());
    if (videoIds.length === 0 && logins.length === 0) return;

    let cancelled = false;
    fetch("/api/streams/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoIds: videoIds.slice(0, 100), logins }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setVodMeta(data.vods ?? {});
        setChannelMeta(data.channels ?? {});
      })
      .catch(() => { /* fallbacks cover it */ });
    return () => { cancelled = true; };
  }, [vods, channels]);

  const addChannel = async () => {
    const url = newUrl.trim();
    const platform = channelPlatform(url);
    if (!platform) {
      setError("Enter a Twitch, YouTube or Kick channel URL.");
      return;
    }
    setAdding(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setAdding(false); return; }
    const { error: insertError } = await supabase
      .from("streams")
      .insert({ user_id: user.id, platform, channel_url: url });
    if (insertError) {
      setError(
        insertError.code === "23505"
          ? "That channel is already connected."
          : "Couldn't add that channel."
      );
    } else {
      setNewUrl("");
      setAddOpen(false);
      await load();
    }
    setAdding(false);
  };

  const removeChannel = async (channel: Channel) => {
    setBusyId(channel.id);
    try {
      // Goes through the route so the EventSub subscription is cleaned up.
      const res = await fetch("/api/twitch/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId: channel.id }),
      });
      if (!res.ok) {
        const supabase = createClient();
        await supabase.from("streams").delete().eq("id", channel.id);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleAutoClip = async (channel: Channel, enabled: boolean) => {
    setBusyId(channel.id);
    // Optimistic, reverted below if the write is rejected.
    setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, auto_clip_enabled: enabled } : c)));
    try {
      const res = await fetch("/api/streams/auto-clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId: channel.id, enabled }),
      });
      if (!res.ok) throw new Error("rejected");
    } catch {
      setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, auto_clip_enabled: !enabled } : c)));
      setError("Couldn't save that change.");
    } finally {
      setBusyId(null);
    }
  };

  const filteredVods = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vods.filter((v) => {
      if (platformFilter !== "all" && v.platform.toLowerCase() !== platformFilter) return false;
      if (!q) return true;
      const title = v.videoId ? vodMeta[v.videoId]?.title ?? "" : "";
      return (
        title.toLowerCase().includes(q) ||
        v.url.toLowerCase().includes(q) ||
        v.clips.some((c) => c.title.toLowerCase().includes(q))
      );
    });
  }, [vods, search, platformFilter, vodMeta]);

  const platformsPresent = useMemo(
    () => Array.from(new Set(vods.map((v) => v.platform))),
    [vods]
  );

  /**
   * Auto-clipping only runs for channels vod-poll actually sweeps: enabled AND
   * OAuth-connected. A URL-only channel can never trigger it, so it is never
   * reported as active.
   */
  const twitchChannels = channels.filter((c) => c.platform === "twitch");
  const activeAutoClip = twitchChannels.filter((c) => c.auto_clip_enabled && c.twitch_user_id);
  const oauthConnected = twitchChannels.filter((c) => c.twitch_user_id);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-6 animate-fade-in font-geist">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="font-geist text-3xl sm:text-4xl font-bold text-white">Streams</h1>
          <p className="text-[15px] text-foreground-muted mt-1">
            Your connected channels and analyzed videos.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-background text-[15px] font-bold hover:bg-accent-dim shadow-accent-glow-sm transition-colors self-start"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Analyze a VOD
        </Link>
      </header>

      {error && (
        <p className="px-4 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Connected channels ── */}
        <section className="bg-surface border border-border rounded-xl p-5">
          <h2 className="font-geist text-lg font-bold text-white">Connected channels</h2>
          <p className="text-sm text-foreground-muted mt-1 mb-4">
            Connect Twitch for automatic clipping, or add another channel.
          </p>

          {loading ? (
            <div className="h-16 rounded-lg bg-surface-2 animate-pulse" />
          ) : channels.length === 0 ? (
            <p className="text-[15px] text-foreground-muted py-4">No channels connected yet.</p>
          ) : (
            <div className="space-y-2.5">
              {channels.map((ch) => {
                const login = ch.twitch_login ?? channelLogin(ch.channel_url);
                const meta = channelMeta[login.toLowerCase()];
                const style = PLATFORM_STYLE[ch.platform];
                return (
                  <div key={ch.id} className="flex items-center gap-3 p-3 rounded-lg bg-surface-2 border border-border">
                    {meta?.avatar ? (
                      /* Real Twitch avatar; plain img since the host isn't in
                         next.config's image allowlist. */
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={meta.avatar} alt="" className="w-11 h-11 rounded-full flex-shrink-0 object-cover" />
                    ) : (
                      <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 border ${style.badge}`}>
                        <PlatformIcon platform={ch.platform} />
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-white truncate">
                        {meta?.displayName ?? login}
                      </p>
                      <p className="text-sm text-foreground-muted truncate">
                        {channelLogin(ch.channel_url)} · {style.name}
                      </p>
                    </div>
                    <span
                      title={
                        ch.twitch_user_id
                          ? "Connected with Twitch — auto-clipping can run"
                          : "Added by URL — auto-clipping needs a Twitch connection"
                      }
                      className={`flex items-center gap-1.5 text-[13px] font-semibold flex-shrink-0 ${
                        ch.twitch_user_id ? "text-accent" : "text-foreground-muted"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${ch.twitch_user_id ? "bg-accent" : "bg-muted"}`} />
                      <span className="hidden sm:inline">{ch.twitch_user_id ? "Connected" : "URL only"}</span>
                    </span>
                    <button
                      onClick={() => removeChannel(ch)}
                      disabled={busyId === ch.id}
                      className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-border text-[13px] font-semibold text-foreground-muted hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-50"
                    >
                      {busyId === ch.id ? "…" : "Remove"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Twitch purple for the Twitch-specific action. */}
          <a
            href="/api/twitch/connect"
            className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-purple-500/40 bg-purple-500/10 text-purple-300 text-[15px] font-bold hover:bg-purple-500/20 transition-colors"
          >
            <PlatformIcon platform="twitch" />
            Connect with Twitch
          </a>

          <button
            onClick={() => setAddOpen((v) => !v)}
            className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border border-dashed text-foreground-muted text-[15px] font-semibold hover:text-foreground hover:border-subtle transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Connect another channel
          </button>

          {addOpen && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://twitch.tv/yourname"
                className="flex-1 px-3 py-2.5 rounded-lg bg-surface-2 border border-border text-[15px] text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent transition-colors"
              />
              <button
                onClick={addChannel}
                disabled={adding || !newUrl.trim()}
                className="px-5 py-2.5 rounded-lg bg-accent text-background text-[15px] font-bold hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          )}
        </section>

        {/* ── Auto-clipping ── */}
        <section className="bg-surface border border-accent/25 rounded-xl p-5 flex flex-col">
          <div className="flex items-start justify-between gap-3">
            <span className="w-11 h-11 rounded-xl bg-accent-glow flex items-center justify-center flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            {oauthConnected.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-foreground-muted">
                  {activeAutoClip.length > 0 ? "On" : "Off"}
                </span>
                <button
                  role="switch"
                  aria-checked={activeAutoClip.length > 0}
                  aria-label="Auto-clipping"
                  disabled={busyId !== null}
                  onClick={() => {
                    const turnOn = activeAutoClip.length === 0;
                    oauthConnected.forEach((c) => toggleAutoClip(c, turnOn));
                  }}
                  className={`w-11 h-6 rounded-full border transition-colors disabled:opacity-50 ${
                    activeAutoClip.length > 0 ? "bg-accent-glow border-accent/50" : "bg-surface-2 border-border"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full transition-transform ${
                      activeAutoClip.length > 0 ? "translate-x-6 bg-accent" : "translate-x-1 bg-foreground-muted"
                    }`}
                  />
                </button>
              </div>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-surface-2 border border-border text-[11px] font-bold text-foreground-muted uppercase tracking-wide">
                Coming soon
              </span>
            )}
          </div>

          <h2 className="font-geist text-xl font-bold text-white mt-3">Auto-clipping</h2>

          {oauthConnected.length > 0 ? (
            <p className="text-[15px] text-foreground-muted mt-1.5">
              When your Twitch stream ends and the VOD is published, Klyp analyzes it and saves
              the clips. Each run spends Sparks from your balance, and is skipped if you
              don&apos;t have enough.
            </p>
          ) : (
            <p className="text-[15px] text-foreground-muted mt-1.5">
              Klyp will analyze each VOD automatically once your stream ends, and save the clips
              for you. Not switched on yet — for now, paste a VOD on the dashboard to clip it.
            </p>
          )}

          <details className="mt-auto pt-4 group">
            <summary className="text-[15px] font-semibold text-accent cursor-pointer list-none flex items-center gap-1.5 hover:gap-2.5 transition-all">
              Learn more
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-open:rotate-90">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </summary>
            <div className="mt-3 space-y-2 text-sm text-foreground-muted leading-relaxed">
              <p>
                Klyp subscribes to Twitch&apos;s stream-offline event. Twitch has no
                &quot;VOD published&quot; event, so Klyp waits and re-checks for a few minutes
                until the recording appears.
              </p>
              <p>
                Each analysis costs Sparks based on the VOD&apos;s length plus the number of
                clips requested. If your balance is too low when a VOD appears, that VOD is
                skipped and you get a notification — nothing is queued or charged later.
              </p>
              <p>Clips land in My Clips, exactly as if you had pasted the VOD yourself.</p>
            </div>
          </details>
        </section>
      </div>

      {/* ── Analyzed VODs ── */}
      <section>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="font-geist text-2xl font-bold text-white">Analyzed VODs</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative">
              <svg
                width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
              >
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search streams…"
                className="w-full sm:w-64 pl-9 pr-3 py-2.5 rounded-lg bg-surface border border-border text-[15px] text-foreground placeholder:text-foreground-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              aria-label="Filter by platform"
              className="px-3 py-2.5 rounded-lg bg-surface border border-border text-[15px] text-foreground focus:outline-none focus:border-accent transition-colors"
            >
              <option value="all">All platforms</option>
              {platformsPresent.map((p) => (
                <option key={p} value={p.toLowerCase()}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-xl bg-surface border border-border animate-pulse" />
            ))}
          </div>
        ) : filteredVods.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl py-16 text-center">
            <p className="font-geist text-lg font-semibold text-white">
              {vods.length === 0 ? "No analyzed VODs yet" : "Nothing matches those filters"}
            </p>
            <p className="text-[15px] text-foreground-muted mt-2">
              {vods.length === 0
                ? "Analyze a VOD and it will appear here."
                : "Try clearing the search or platform filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredVods.map((vod) => {
              const meta = vod.videoId ? vodMeta[vod.videoId] : undefined;
              const top = vod.clips[0];
              return (
                <div
                  key={vod.url}
                  className="bg-surface border border-border rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-accent/30 transition-colors"
                >
                  {/* Frame from the VOD's best clip — Klyp has no VOD-level still. */}
                  <div className="w-full sm:w-40 flex-shrink-0">
                    <ClipThumbnail clip={top} onPlay={() => { window.location.href = `/dashboard/clips?vod=${encodeURIComponent(vod.url)}`; }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[17px] font-bold text-white truncate">
                      {meta?.title ?? (vod.videoId ? `Twitch VOD ${vod.videoId}` : vod.platform === "Upload" ? "Uploaded video" : vod.url)}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-sm text-foreground-muted">
                      <span className="flex items-center gap-1.5">
                        <PlatformIcon platform={vod.platform} className="opacity-80" />
                        {vod.platform}
                      </span>
                      <span className="text-subtle">·</span>
                      <span>{fmtDate(vod.latest)}</span>
                      {meta?.durationSeconds ? (
                        <>
                          <span className="text-subtle">·</span>
                          <span>{fmtLength(meta.durationSeconds)}</span>
                        </>
                      ) : null}
                      {!meta && vod.videoId && (
                        <>
                          <span className="text-subtle">·</span>
                          <span title="Twitch deletes VODs after a few weeks">no longer on Twitch</span>
                        </>
                      )}
                    </div>
                    <p className="text-sm text-foreground-muted mt-1.5 truncate">
                      Top clip: <span className="text-foreground">&ldquo;{top.title}&rdquo;</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-5 sm:gap-6 flex-shrink-0">
                    <div className="text-center">
                      <p className="font-geist text-xl font-bold text-white tabular-nums">{vod.count}</p>
                      <p className="text-[12px] text-foreground-muted">Clips</p>
                    </div>
                    <div className="text-center">
                      <p className="font-geist text-xl font-bold text-accent tabular-nums">{vod.best}</p>
                      <p className="text-[12px] text-foreground-muted">Best AI score</p>
                    </div>
                    <div className="text-center">
                      <p className="font-geist text-xl font-bold text-white tabular-nums">{vod.avg}</p>
                      <p className="text-[12px] text-foreground-muted">Avg AI score</p>
                    </div>
                  </div>

                  <Link
                    href={`/dashboard/clips?vod=${encodeURIComponent(vod.url)}`}
                    className="flex-shrink-0 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-accent/40 text-accent text-[15px] font-bold hover:bg-accent-glow transition-colors"
                  >
                    View clips
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[13px] text-foreground-muted mt-4">
          AI scores are Klyp&apos;s own estimates of viral potential, not measured performance.
        </p>
      </section>
    </div>
  );
}
