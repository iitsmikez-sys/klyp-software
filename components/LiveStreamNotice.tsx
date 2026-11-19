import type { LiveMode } from "@/lib/live-vod";

const COPY: Record<LiveMode, { body: string }> = {
  upsell: { body: "Klyp can clip it once it ends. Want clips the moment you go offline? Pro clips every stream automatically." },
  auto: { body: "Auto-clipping will pick it up when it ends. Nothing to do. Your clips will show up in your dashboard." },
  connect: { body: "Connect Twitch and Klyp will clip it automatically when it ends." },
  wait: { body: "Klyp can clip it once it ends. Come back when the stream is over and paste the link again." },
};

/** Shown instead of the video preview when the pasted Twitch link is a stream that is still going. Nothing is charged. */
export default function LiveStreamNotice({ mode }: { mode: LiveMode }) {
  const done = mode === "auto";
  return (
    <div data-live-stream={mode} role="status"
      className={`mt-2 space-y-2 rounded-lg border p-3 ${done ? "border-green-500/30 bg-green-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
      <p className="text-sm font-semibold text-foreground">This stream is still live</p>
      <p className="text-xs leading-relaxed text-foreground-muted">{COPY[mode].body}</p>
      {mode === "upsell" && (
        <div className="flex flex-wrap items-center gap-3">
          <a href="/dashboard/upgrade?need=live" className="flex min-h-9 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-background transition-colors hover:bg-accent-dim">Get auto-clipping</a>
          <span className="text-xs text-foreground-muted">Or come back when the stream is over. Nothing was charged.</span>
        </div>
      )}
      {mode === "connect" && (
        <a href="/dashboard/streams" className="inline-flex min-h-9 items-center justify-center rounded-lg bg-accent px-3 text-sm font-semibold text-background transition-colors hover:bg-accent-dim">Connect Twitch</a>
      )}
    </div>
  );
}
