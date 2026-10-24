type Video = { id: string; created_at: string };

/** Twitch returns newest first; process all unseen VODs in publication order. */
export function unseenVods<T extends Video>(
  videos: T[], lastSeenId: string | null, connectedAt: string,
): T[] {
  return videos.filter((video) =>
    video.id !== lastSeenId &&
    (lastSeenId === null
      ? new Date(video.created_at).getTime() > new Date(connectedAt).getTime()
      : BigInt(video.id) > BigInt(lastSeenId))
  ).reverse();
}
