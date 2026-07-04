/**
 * Twitch chat spike detection — samples the VOD's chat replay and finds the
 * windows where chat went off, so the analysis brain can weight those moments.
 *
 * Uses Twitch's public GQL endpoint (same API the web player's chat replay
 * uses — no OAuth needed). Instead of paginating the entire replay (thousands
 * of sequential requests on a long VOD), we sample pages at fixed offsets in
 * parallel and estimate messages/second from each page's timestamp span.
 */

const GQL_URL = "https://gql.twitch.tv/gql";
// Twitch's public web-player client id — required for anonymous GQL access.
const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
// Persisted query hash for VideoCommentsByOffsetOrCursor (chat replay).
const COMMENTS_QUERY_HASH = "b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a";

const SAMPLE_INTERVAL_S = 60; // one density sample per minute of VOD
const CONCURRENCY = 8;
const MAX_SAMPLES = 400; // hard cap (~6.5h VOD) so we never hammer the API

export type ChatSpike = {
  /** VOD offset where the spike occurs (seconds). */
  seconds: number;
  /** Chat speed relative to the VOD's average (e.g. 3.2 = 3.2× normal). */
  intensity: number;
};

export function twitchVideoId(url: string): string | null {
  const m = url.match(/twitch\.tv\/videos\/(\d+)/i);
  return m ? m[1] : null;
}

type Sample = { offset: number; rate: number };

/** Fetch one chat-replay page at a VOD offset and estimate messages/sec. */
async function sampleAt(videoId: string, offset: number): Promise<Sample | null> {
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: { "Client-ID": CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "VideoCommentsByOffsetOrCursor",
      variables: { videoID: videoId, contentOffsetSeconds: offset },
      extensions: {
        persistedQuery: { version: 1, sha256Hash: COMMENTS_QUERY_HASH },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  const edges: Array<{ node?: { contentOffsetSeconds?: number } }> =
    data?.data?.video?.comments?.edges ?? [];
  const times = edges
    .map((e) => e.node?.contentOffsetSeconds)
    .filter((t): t is number => typeof t === "number");
  if (times.length < 2) return { offset, rate: 0 };

  const span = Math.max(1, Math.max(...times) - Math.min(...times));
  return { offset, rate: times.length / span };
}

/**
 * Detect chat spikes across the VOD. Returns up to 10 spikes sorted by
 * intensity, or null if the replay is unavailable (subs-only VOD, muted chat,
 * network failure) — analysis proceeds without hints in that case.
 */
export async function detectChatSpikes(
  url: string,
  durationSeconds: number
): Promise<ChatSpike[] | null> {
  const videoId = twitchVideoId(url);
  if (!videoId || durationSeconds < SAMPLE_INTERVAL_S * 3) return null;

  const offsets: number[] = [];
  for (let t = 0; t < durationSeconds && offsets.length < MAX_SAMPLES; t += SAMPLE_INTERVAL_S) {
    offsets.push(t);
  }

  const samples: Sample[] = [];
  try {
    for (let i = 0; i < offsets.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        offsets.slice(i, i + CONCURRENCY).map((o) => sampleAt(videoId, o).catch(() => null))
      );
      for (const s of batch) if (s) samples.push(s);
    }
  } catch {
    return null;
  }
  if (samples.length < 3) return null;

  const rates = samples.map((s) => s.rate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return null;
  const std = Math.sqrt(rates.reduce((a, r) => a + (r - mean) ** 2, 0) / rates.length);
  const threshold = mean + 1.5 * std;

  const spikes = samples
    .filter((s) => s.rate >= threshold)
    .map((s) => ({ seconds: s.offset, intensity: s.rate / mean }))
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 10);

  return spikes.length > 0 ? spikes : null;
}

/** Render spikes as a prompt block for the Claude analysis call. */
export function formatSpikesForPrompt(spikes: ChatSpike[]): string {
  const stamp = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const lines = spikes
    .slice()
    .sort((a, b) => a.seconds - b.seconds)
    .map((s) => `[${stamp(s.seconds)}] chat activity ${s.intensity.toFixed(1)}× the stream average`);
  return `Twitch chat replay spikes (moments where chat exploded — strong viral signals):\n${lines.join("\n")}`;
}
