"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";
import { CLAIM_AFTER_RESET_COOKIE, CLAIM_NEXT_COOKIE, RESET_PATH, safeClaimNext } from "@/lib/claim-next";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // After the email link signs them in, the callback sends them to the new-password page, and from there
    // back to the /claim page they came from (if any).
    document.cookie = `${CLAIM_NEXT_COOKIE}=${encodeURIComponent(RESET_PATH)}; path=/; max-age=3600; samesite=lax`;
    const claim = safeClaimNext(new URLSearchParams(window.location.search).get("next"));
    if (claim) document.cookie = `${CLAIM_AFTER_RESET_COOKIE}=${encodeURIComponent(claim)}; path=/; max-age=3600; samesite=lax`;
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <div className="bg-surface border border-border rounded-2xl p-8">
          <h1 className="font-syne text-2xl font-bold text-foreground mb-1">Reset your password</h1>
          <p className="text-sm text-foreground-muted mb-6">Enter your email and we'll send you a link to choose a new one.</p>

          {sent ? (
            <div className="px-3.5 py-2.5 rounded-lg bg-accent-glow border border-accent/30 text-xs text-accent">
              If there's an account for that email, a reset link is on its way. It can take a minute, and check your spam folder.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground-muted mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
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
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          <p className="text-center text-xs text-foreground-muted mt-6">
            <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
