"use client";

/**
 * Compact banner above the analyze panel, replacing the old Quick Start list.
 *
 * It reflects the real state of public.streams: an invitation to connect when
 * there is nothing linked, and the actual channel(s) plus a Manage streams
 * action when there is. Both routes go to the existing /dashboard/streams
 * flow — this adds no new connection path of its own.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Stream = { id: string; platform: string; channel_url: string };

/** Channel name from a Twitch/YouTube/Kick channel URL, for display only. */
function channelName(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    return path.split("/").pop() || url;
  } catch {
    return url;
  }
}

export default function ConnectStreamBanner() {
  const [streams, setStreams] = useState<Stream[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("streams")
      .select("id,platform,channel_url")
      .then(({ data }) => {
        if (!cancelled) setStreams(data ?? []);
      });
    return () => { cancelled = true; };
  }, []);

  const connected = streams !== null && streams.length > 0;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:px-5 rounded-xl bg-surface border border-accent/25">
      <span
        className={`flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center ${
          connected ? "bg-accent-glow" : "bg-surface-2 border border-border"
        }`}
      >
        <svg
          width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke={connected ? "#00E5A0" : "#9898b0"}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M1.42 9a16 16 0 0 1 21.16 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </span>

      <div className="flex-1 min-w-0">
        {streams === null ? (
          <>
            <div className="h-5 w-48 rounded bg-surface-2 animate-pulse" />
            <div className="h-4 w-72 max-w-full rounded bg-surface-2 animate-pulse mt-2" />
          </>
        ) : connected ? (
          <>
            <p className="font-geist text-base font-semibold text-white">
              {streams.length === 1
                ? `Connected to ${channelName(streams[0].channel_url)}`
                : `${streams.length} streams connected`}
            </p>
            <p className="text-[15px] text-foreground-muted mt-0.5">
              Klyp watches {streams.length === 1 ? "this channel" : "these channels"} and clips your
              best moments automatically when you go live.
            </p>
          </>
        ) : (
          <>
            <p className="font-geist text-base font-semibold text-white">Connect your live stream</p>
            <p className="text-[15px] text-foreground-muted mt-0.5">
              Link your Twitch or YouTube account to automatically find and clip your best moments.
            </p>
          </>
        )}
      </div>

      <Link
        href="/dashboard/streams"
        className={`flex-shrink-0 px-5 py-2.5 rounded-lg text-[15px] font-bold text-center transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${
          connected
            ? "border border-accent/40 text-accent hover:bg-accent-glow"
            : "bg-accent text-background hover:bg-accent-dim shadow-accent-glow-sm"
        }`}
      >
        {connected ? "Manage streams" : "Connect stream"}
      </Link>
    </div>
  );
}
