"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { type SavedClip, TYPE_STYLES, fmtDate, platformName } from "@/lib/clip-ui";

type StreamGroup = {
  url: string;
  platform: string;
  clips: SavedClip[];
  topClip: SavedClip;
  avgScore: number;
  latest: string;
};

type Channel = {
  id: string;
  platform: "twitch" | "youtube" | "kick";
  channel_url: string;
  created_at: string;
  twitch_user_id: string | null;
  twitch_login: string | null;
  auto_clip_enabled: boolean;
};

const TWITCH_STATUS_MESSAGE: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "Twitch channel connected — auto-clipping is live for new VODs.", ok: true },
  already_connected: { text: "That Twitch channel is already connected.", ok: false },
  state_mismatch: { text: "Twitch connect failed (session expired) — try again.", ok: false },
  not_signed_in: { text: "Sign in first, then connect Twitch.", ok: false },
  save_failed: { text: "Couldn't save the connection — try again.", ok: false },
  error: { text: "Twitch connect failed — try again.", ok: false },
};

/** Derive the platform from a channel URL; null = unsupported. */
function channelPlatform(url: string): Channel["platform"] | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return "twitch";
    if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) return "youtube";
    if (host === "kick.com" || host.endsWith(".kick.com")) return "kick";
  } catch { /* invalid URL */ }
  return null;
}

const PLATFORM_BADGE: Record<Channel["platform"], string> = {
  twitch: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  youtube: "bg-red-500/15 text-red-400 border-red-500/30",
  kick: "bg-accent-glow text-accent border-accent/30",
};

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "Twitch") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.265 3 3 6.236v13.223h4.502V21l2.531.001L12.298 19.459h3.712L21 14.481V3H4.265zm15.047 10.505-2.531 2.531h-4.259l-2.28 2.28v-2.28H6.545V4.687h12.767v8.818zM16.777 7.5h-1.687v5.063h1.687V7.5zm-4.5 0H10.59v5.063h1.687V7.5z" />
      </svg>
    );
  }
  if (platform === "YouTube") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

export default function StreamsPage() {
  const [clips, setClips] = useState<SavedClip[]>([]);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelInput, setChannelInput] = useState("");
  const [channelError, setChannelError] = useState<string | null>(null);
  const [savingChannel, setSavingChannel] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [twitchStatus, setTwitchStatus] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("clips")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setClips(data ?? []);
        setLoading(false);
      });
    supabase
      .from("streams")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => setChannels(data ?? []));

    // One-time banner from the /api/twitch/callback redirect — read from the
    // URL directly (not useSearchParams) so this page doesn't need a Suspense
    // boundary just for a post-redirect status message.
    const twitch = new URLSearchParams(window.location.search).get("twitch");
    if (twitch && TWITCH_STATUS_MESSAGE[twitch]) {
      setTwitchStatus(TWITCH_STATUS_MESSAGE[twitch]);
      const url = new URL(window.location.href);
      url.searchParams.delete("twitch");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const addChannel = async () => {
    const url = channelInput.trim();
    if (!url || savingChannel) return;
    const platform = channelPlatform(url);
    if (!platform) {
      setChannelError("Enter a Twitch, YouTube, or Kick channel URL (e.g. https://twitch.tv/yourname).");
      return;
    }
    if (platform === "twitch") {
      setChannelError("Use “Connect with Twitch” below instead — it enables auto-clipping, a pasted link doesn't.");
      return;
    }
    setSavingChannel(true);
    setChannelError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setChannelError("Sign in first.");
      setSavingChannel(false);
      return;
    }
    const { data, error } = await supabase
      .from("streams")
      .insert({ user_id: user.id, platform, channel_url: url })
      .select()
      .single();
    if (error) {
      setChannelError(
        error.message.includes("duplicate")
          ? "That channel is already connected."
          : error.message.includes("streams")
          ? "The streams table doesn't exist yet — run supabase/migrations/002_streams.sql."
          : error.message
      );
    } else if (data) {
      setChannels((prev) => [...prev, data as Channel]);
      setChannelInput("");
    }
    setSavingChannel(false);
  };

  const removeChannel = async (channel: Channel) => {
    setRemovingId(channel.id);
    if (channel.twitch_user_id) {
      // Routes through the server so the EventSub subscription gets cleaned
      // up too — a plain client-side delete would leave it orphaned on Twitch.
      await fetch("/api/twitch/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId: channel.id }),
      });
    } else {
      const supabase = createClient();
      await supabase.from("streams").delete().eq("id", channel.id);
    }
    setChannels((prev) => prev.filter((c) => c.id !== channel.id));
    setRemovingId(null);
  };

  const streams: StreamGroup[] = useMemo(() => {
    const byUrl = new Map<string, SavedClip[]>();
    for (const clip of clips) {
      const list = byUrl.get(clip.url) ?? [];
      list.push(clip);
      byUrl.set(clip.url, list);
    }
    return Array.from(byUrl.entries())
      .map(([url, group]) => ({
        url,
        platform: platformName(url),
        clips: group,
        topClip: group.reduce((a, b) => (b.viral_score > a.viral_score ? b : a)),
        avgScore: Math.round(group.reduce((sum, c) => sum + c.viral_score, 0) / group.length),
        latest: group[0].created_at,
      }))
      .sort((a, b) => +new Date(b.latest) - +new Date(a.latest));
  }, [clips]);

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-syne text-3xl font-bold text-foreground">Streams</h1>
          <p className="text-foreground-muted mt-1 text-sm">
            Every VOD you&apos;ve analyzed — {streams.length} stream{streams.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="px-5 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm whitespace-nowrap"
        >
          + Analyze a VOD
        </Link>
      </header>

      {twitchStatus && (
        <div
          className={`mb-6 px-4 py-3 rounded-lg border text-sm ${
            twitchStatus.ok
              ? "bg-accent-glow border-accent/30 text-accent"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          {twitchStatus.text}
        </div>
      )}

      {/* ── Connected channels + auto-clipping ── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-1">Connected Channels</h2>
          <p className="text-sm text-foreground-muted mb-4">
            Connect Twitch for automatic clipping, or paste a YouTube/Kick channel to keep an eye on it.
          </p>

          <a
            href="/api/twitch/connect"
            className="mb-3 flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-[#9146FF] text-white text-sm font-bold font-syne hover:bg-[#7d3cdb] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.265 3 3 6.236v13.223h4.502V21l2.531.001L12.298 19.459h3.712L21 14.481V3H4.265zm15.047 10.505-2.531 2.531h-4.259l-2.28 2.28v-2.28H6.545V4.687h12.767v8.818zM16.777 7.5h-1.687v5.063h1.687V7.5zm-4.5 0H10.59v5.063h1.687V7.5z" />
            </svg>
            Connect with Twitch
          </a>

          <div className="flex gap-2 mb-3">
            <input
              type="url"
              value={channelInput}
              onChange={(e) => { setChannelInput(e.target.value); setChannelError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") addChannel(); }}
              placeholder="https://youtube.com/@yourname (YouTube/Kick only)"
              className="flex-1 px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors min-w-0"
            />
            <button
              onClick={addChannel}
              disabled={savingChannel || !channelInput.trim()}
              className="px-4 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-50 disabled:shadow-none whitespace-nowrap"
            >
              {savingChannel ? "Saving…" : "Connect"}
            </button>
          </div>

          {channelError && (
            <p className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {channelError}
            </p>
          )}

          {channels.length === 0 ? (
            <p className="text-xs text-subtle">No channels connected yet.</p>
          ) : (
            <ul className="space-y-2">
              {channels.map((ch) => (
                <li
                  key={ch.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-2 border border-border group"
                >
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold font-syne uppercase tracking-wide flex-shrink-0 ${PLATFORM_BADGE[ch.platform]}`}>
                    {ch.platform}
                  </span>
                  <a
                    href={ch.channel_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs text-foreground-muted hover:text-accent transition-colors truncate"
                  >
                    {ch.channel_url}
                  </a>
                  {ch.twitch_user_id && (
                    <span className="flex-shrink-0 text-[10px] font-bold font-syne text-accent">
                      ⚡ Auto-clip on
                    </span>
                  )}
                  <button
                    onClick={() => removeChannel(ch)}
                    disabled={removingId === ch.id}
                    title="Disconnect channel"
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 flex items-center justify-center rounded text-foreground-muted hover:text-red-400 hover:bg-red-500/10 flex-shrink-0 disabled:opacity-40"
                  >
                    {removingId === ch.id ? (
                      <span className="w-3 h-3 rounded-full border border-foreground-muted border-t-transparent animate-spin" />
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="relative bg-surface border border-accent/25 rounded-xl p-6 overflow-hidden">
          <div className="w-10 h-10 rounded-xl bg-accent-glow flex items-center justify-center text-accent mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <h2 className="font-syne text-lg font-semibold text-foreground mb-1">Auto-Clipping</h2>
          <p className="text-sm text-foreground-muted leading-relaxed mb-2">
            Connected Twitch channels are watched automatically — when a stream
            ends and its VOD publishes, Klyp clips it the same way a manual
            &quot;Find clips&quot; run would, no link to paste.
          </p>
          <p className="text-xs text-foreground-muted leading-relaxed">
            If your Sparks balance is too low when a new VOD is found, Klyp
            skips it and notifies you instead of queuing — top up and re-run it
            manually from the dashboard.
          </p>
        </div>
      </section>

      <h2 className="font-syne text-lg font-semibold text-foreground mb-4">Analyzed VODs</h2>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <span className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      ) : streams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center bg-surface border border-border rounded-2xl">
          <div className="w-14 h-14 rounded-full bg-accent-glow flex items-center justify-center mb-4">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2H3v16h5v4l4-4h5l4-4V2z" />
            </svg>
          </div>
          <p className="font-syne font-semibold text-foreground">No streams analyzed yet</p>
          <p className="text-sm text-foreground-muted mt-1 mb-5">
            Paste a Twitch or YouTube VOD link and Klyp will hunt down the best moments.
          </p>
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm"
          >
            Analyze your first VOD
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {streams.map((stream) => (
            <div
              key={stream.url}
              className="bg-surface border border-border rounded-xl p-5 hover:border-accent/30 transition-colors"
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                {/* Platform */}
                <div className={`flex items-center justify-center w-11 h-11 rounded-xl flex-shrink-0 ${
                  stream.platform === "Twitch"
                    ? "bg-purple-500/15 text-purple-400"
                    : stream.platform === "YouTube"
                    ? "bg-red-500/15 text-red-400"
                    : "bg-accent-glow text-accent"
                }`}>
                  <PlatformIcon platform={stream.platform} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{stream.platform} VOD</p>
                    <span className="text-[10px] text-subtle">·</span>
                    <p className="text-xs text-foreground-muted">{fmtDate(stream.latest)}</p>
                  </div>
                  <a
                    href={stream.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-foreground-muted hover:text-accent transition-colors truncate block max-w-md"
                  >
                    {stream.url}
                  </a>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`px-2 py-0.5 rounded border text-[10px] font-bold font-syne ${TYPE_STYLES[stream.topClip.clip_type] ?? TYPE_STYLES.HIGHLIGHT}`}>
                      {stream.topClip.clip_type}
                    </span>
                    <span className="text-xs text-foreground-muted truncate">
                      Top clip: “{stream.topClip.title}”
                    </span>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6 flex-shrink-0">
                  <div className="text-center">
                    <p className="font-syne text-xl font-bold text-foreground">{stream.clips.length}</p>
                    <p className="text-[10px] text-foreground-muted uppercase tracking-wider">clips</p>
                  </div>
                  <div className="text-center">
                    <p className={`font-syne text-xl font-bold ${stream.topClip.viral_score >= 85 ? "text-accent" : "text-foreground"}`}>
                      {stream.topClip.viral_score}
                    </p>
                    <p className="text-[10px] text-foreground-muted uppercase tracking-wider">best</p>
                  </div>
                  <div className="text-center">
                    <p className="font-syne text-xl font-bold text-foreground">{stream.avgScore}</p>
                    <p className="text-[10px] text-foreground-muted uppercase tracking-wider">avg</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
