"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "discord" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = createClient();

  const handleOAuth = async (provider: "google" | "discord") => {
    setOauthLoading(provider);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) setError(error.message);
      // On success the browser navigates away — no need to reset loading.
    } catch (err) {
      setError(
        err instanceof Error && err.message.toLowerCase().includes("fetch")
          ? "Can't reach the auth server — the Supabase project may be paused. Check supabase.com/dashboard."
          : err instanceof Error
          ? err.message
          : "Sign-in failed."
      );
    }
    setOauthLoading(null);
  };

  const handleGoogle = () => handleOAuth("google");
  const handleDiscord = () => handleOAuth("discord");

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
      } else if (data.session) {
        // Auto-confirm is on — we're already signed in, go straight to the app.
        router.push("/dashboard");
        router.refresh();
      } else {
        setMessage("Check your email for a confirmation link.");
        setLoading(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <div className="bg-surface border border-border rounded-2xl p-8">
          <h1 className="font-syne text-2xl font-bold text-foreground mb-1">Welcome back</h1>
          <p className="text-sm text-foreground-muted mb-6">Sign in to your Klyp account.</p>

          <div className="space-y-3 mb-6">
            <button
              onClick={handleGoogle}
              disabled={oauthLoading !== null || loading}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg bg-surface-2 border border-border text-sm font-medium text-foreground hover:border-subtle transition-colors disabled:opacity-60"
            >
              {oauthLoading === "google" ? (
                <span className="w-4 h-4 rounded-full border-2 border-foreground-muted border-t-transparent animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#9898b0" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#9898b0" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#9898b0" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#9898b0" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              Continue with Google
            </button>

            <button
              onClick={handleDiscord}
              disabled={oauthLoading !== null || loading}
              className="w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg bg-surface-2 border border-border text-sm font-medium text-foreground hover:border-subtle transition-colors disabled:opacity-60"
            >
              {oauthLoading === "discord" ? (
                <span className="w-4 h-4 rounded-full border-2 border-foreground-muted border-t-transparent animate-spin" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#9898b0">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.081.114 18.105.133 18.12a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                </svg>
              )}
              Continue with Discord
            </button>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs text-foreground-muted">
              <span className="bg-surface px-3">or sign in with email</span>
            </div>
          </div>

          <form onSubmit={handleEmail} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={loading || oauthLoading !== null}
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading || oauthLoading !== null}
                className="w-full px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
              />
            </div>

            {error && (
              <div className="px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                {error}
              </div>
            )}
            {message && (
              <div className="px-3.5 py-2.5 rounded-lg bg-accent-glow border border-accent/30 text-xs text-accent">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || oauthLoading !== null}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent text-background text-sm font-semibold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm disabled:opacity-60 disabled:shadow-none"
            >
              {loading && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-background border-t-transparent animate-spin" />
              )}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="text-center text-xs text-foreground-muted mt-4">
            {mode === "signin" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  onClick={() => { setMode("signup"); setError(null); setMessage(null); }}
                  className="text-accent hover:underline"
                >
                  Sign up free
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => { setMode("signin"); setError(null); setMessage(null); }}
                  className="text-accent hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="text-center text-xs text-foreground-muted mt-4">
          <Link href="/" className="text-accent hover:underline">
            ← Back to klyp.world
          </Link>
        </p>
      </div>
    </div>
  );
}
