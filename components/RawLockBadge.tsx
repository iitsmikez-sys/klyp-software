/** The "Download Raw" label for a Free member: a lock and a small PRO tag, so it is clear Raw is a Pro feature. */
export default function RawLockBadge({ label = "Download Raw" }: { label?: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-1.5">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      {label}
      <span className="rounded bg-accent px-1 text-[9px] font-extrabold uppercase tracking-wider text-background">Pro</span>
    </span>
  );
}
