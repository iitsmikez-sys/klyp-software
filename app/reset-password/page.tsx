"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import PasswordInput from "@/components/PasswordInput";
import { createClient } from "@/lib/supabase/client";
import { CLAIM_AFTER_RESET_COOKIE, CLAIM_NEXT_COOKIE, safeClaimNext } from "@/lib/claim-next";

const readCookie = (name: string) => {
  const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  try { return decodeURIComponent(hit.slice(name.length + 1)); } catch { return null; }
};
const clearCookie = (name: string) => { document.cookie = `${name}=; path=/; max-age=0`; };

export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [ready, setReady] = useState<"checking" | "yes" | "no">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The reset email signs them in first (see /auth/callback). No session means the link was old or already used.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setReady(data.user ? "yes" : "no"));
  }, [supabase]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("Those two passwords don't match.");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const claim = safeClaimNext(readCookie(CLAIM_AFTER_RESET_COOKIE));
    clearCookie(CLAIM_AFTER_RESET_COOKIE);
    clearCookie(CLAIM_NEXT_COOKIE);
    router.push(claim ?? "/dashboard");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <div className="bg-surface border border-border rounded-2xl p-8">
          <h1 className="font-syne text-2xl font-bold text-foreground mb-1">Choose a new password</h1>

          {ready === "checking" && <p className="text-sm text-foreground-muted mt-4">One moment…</p>}

          {ready === "no" && (
            <>
              <p className="text-sm text-foreground-muted mt-2 mb-6">That reset link has expired or was already used. Request a new one and try again.</p>
              <Link href="/forgot-password" className="block w-full text-center py-2.5 rounded-lg bg-accent text-background text-sm font-semibold font-syne hover:bg-accent-dim transition-colors">
                Send a new link
              </Link>
            </>
          )}

          {ready === "yes" && (
            <form onSubmit={handleSubmit} className="space-y-4 mt-6">
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">New password</label>
                <PasswordInput
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Type it again</label>
                <PasswordInput
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={loading}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
                />
              </div>
              {error && (
                <div className="px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-accent text-background text-sm font-semibold font-syne hover:bg-accent-dim transition-colors disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
