"use client";

import { useState, FormEvent } from "react";

/**
 * `next` arrives from the query string, so it is attacker-controllable. Only
 * same-site paths are followed; anything else falls back to the dashboard
 * rather than becoming an open redirect off klyp.world.
 */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export default function AccessGateForm({ next }: { next: string }) {
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/access-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword }),
      });

      if (res.ok) {
        // A full navigation, not router.push: the gate cookie was set by the
        // response we just received, and a client-side push re-renders from the
        // router cache the server built *before* that cookie existed — so the
        // gate renders again and the button spins forever on a correct keyword.
        // Reloading guarantees the server sees the cookie. replace() also keeps
        // the gate out of history, so Back doesn't return to it.
        window.location.replace(safeNext(next));
        return;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Incorrect keyword.");
        setLoading(false);
      }
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-foreground-muted mb-1.5">
          Access keyword
        </label>
        <input
          type="password"
          required
          autoFocus
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="••••••••"
          disabled={loading}
          className="w-full px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
        />
      </div>

      {error && (
        <div className="px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-background text-sm font-semibold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-60 disabled:shadow-none"
      >
        {loading && (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
        )}
        Continue
      </button>
    </form>
  );
}
