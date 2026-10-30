/** Progress delivery is best-effort: the analysis job owns its own lifecycle. */
export function createSafeEventSender(
  controller: Pick<ReadableStreamDefaultController<Uint8Array>, "enqueue" | "close">,
) {
  const encoder = new TextEncoder();
  let open = true;
  return {
    send(event: unknown): boolean {
      if (!open) return false;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        return true;
      } catch {
        open = false;
        return false;
      }
    },
    ping(): boolean {
      if (!open) return false;
      try { controller.enqueue(encoder.encode(": ping\n\n")); return true; }
      catch { open = false; return false; }
    },
    close(): void {
      if (!open) return;
      open = false;
      try { controller.close(); } catch { /* browser already disconnected */ }
    },
  };
}
