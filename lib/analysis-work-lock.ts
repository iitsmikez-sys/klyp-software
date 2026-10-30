/** The deployment currently runs one Node instance. Guard duplicate paid work in that instance. */
const shared = globalThis as typeof globalThis & { __klypAnalysisWork?: Set<string> };
const active = shared.__klypAnalysisWork ??= new Set<string>();

export async function withSourceWorkLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (active.has(key)) throw new Error('This VOD is already being analyzed. Wait for the current run to finish.');
  active.add(key);
  try { return await fn(); }
  finally { active.delete(key); }
}
