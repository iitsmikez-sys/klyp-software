/**
 * Called once per server boot (see next.config.mjs's experimental.instrumentationHook).
 * Starts the Auto-Clipping background worker — processing service only, so it
 * never runs on the Vercel frontend deployment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DEPLOYMENT_TARGET === "processing"
    && process.env.KLYP_DISABLE_BACKGROUND_WORKER !== "1") {
    const { startAutoClipWorker } = await import("@/lib/vod-poll");
    startAutoClipWorker();
    const { startEditorAssetCleanup } = await import("@/lib/editor-asset-cleanup");
    startEditorAssetCleanup();
  }
}
