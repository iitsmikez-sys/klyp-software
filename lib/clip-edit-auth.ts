/** Avoid revealing whether another user's clip ID exists. */
export function authorizeClipDraftWrite(
  userId: string | null,
  ownerId: string | null,
  tier: string | null,
  subscriptionId: string | null,
): 401 | 403 | 404 | null {
  if (!userId) return 401;
  if (!ownerId || ownerId !== userId) return 404;
  if (tier !== "pro" || !subscriptionId) return 403;
  return null;
}
