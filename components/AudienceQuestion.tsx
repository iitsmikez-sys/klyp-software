"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AUDIENCE_KEY, AUDIENCE_OPTIONS, shouldAskAudience, type StoredAudience } from "@/lib/clip-audience";

/** One quick question for new accounts: whose videos will they clip? Saved on the account, never asked twice. */
export default function AudienceQuestion() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await createClient().auth.getUser();
        if (live && shouldAskAudience(data.user)) setOpen(true);
      } catch { /* no question is better than a broken dashboard */ }
    })();
    return () => { live = false; };
  }, []);

  const answer = async (value: StoredAudience) => {
    setOpen(false);
    try { await createClient().auth.updateUser({ data: { [AUDIENCE_KEY]: value } }); } catch { /* it will simply ask again next visit */ }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void answer("skipped"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true" aria-labelledby="audience-title" data-audience-question>
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <p className="text-xs text-foreground-muted">One quick question</p>
        <h3 id="audience-title" className="mt-1 font-syne text-xl font-bold text-foreground">Whose videos will you clip?</h3>
        <p className="mt-1 text-sm text-foreground-muted">We&apos;ll tune the clip finder to fit.</p>
        <div className="mt-5 flex flex-col gap-2.5">
          {AUDIENCE_OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={() => void answer(o.value)} data-audience-option={o.value}
              className="rounded-xl border border-border px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent/10">
              <span className="block text-sm font-semibold text-foreground">{o.title}</span>
              <span className="block text-xs text-foreground-muted">{o.hint}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void answer("skipped")} data-audience-skip className="mt-4 w-full text-center text-xs text-foreground-muted underline underline-offset-2 hover:text-foreground">Skip for now</button>
      </div>
    </div>
  );
}
