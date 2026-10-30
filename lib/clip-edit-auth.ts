/** Avoid revealing whether another user's clip ID exists. */
export function authorizeClipDraftWrite(
  userId: string | null,
  ownerId: string | null,
  _tier: string | null,
  _subscriptionId: string | null,
): 401 | 403 | 404 | null {
  if (!userId) return 401;
  if (!ownerId || ownerId !== userId) return 404;
  return null;
}
