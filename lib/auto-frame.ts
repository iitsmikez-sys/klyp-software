import { validateVerticalLayout, type VerticalLayoutV1 } from './vertical-layout.ts';

/** Only a confident, bounded recommendation may change the user's framing. */
export function parseFrameSuggestion(input: unknown): VerticalLayoutV1 | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (typeof value.confidence !== 'number' || value.confidence < 0.72 || value.confidence > 1) return null;
  try {
    return validateVerticalLayout({ version: 1, gameplay: value.gameplay, ...(value.facecam ? { facecam: value.facecam } : {}) });
  } catch { return null; }
}

export function validateFrameSamples(input: unknown): Buffer[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) throw new RangeError('Send one to three sample frames.');
  return input.map(frame => {
    if (typeof frame !== 'string' || frame.length > 340_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(frame)) throw new RangeError('Invalid sample frame.');
    const bytes = Buffer.from(frame, 'base64');
    if (bytes.length < 6 || bytes.length > 250_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new RangeError('Sample must be a small JPEG.');
    return bytes;
  });
}

/** Read before parsing so a missing Content-Length cannot bypass the image budget. */
export async function readBoundedFrameBody(req: Request): Promise<unknown> {
  if (!req.body) throw new RangeError('Missing frame body.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1_100_000) { await reader.cancel(); throw new RangeError('Frame request is too large.'); }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}
