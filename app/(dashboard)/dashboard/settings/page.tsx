"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CAPTION_STYLES, type CaptionStyle } from "@/lib/clips";
import { SPARKS_ALLOWANCE, type Profile } from "@/lib/tier";
import { useSparks } from "@/components/SparksProvider";
import { SparkIcon } from "@/components/SparksBalance";
import UpgradeButton from "@/components/UpgradeButton";
import { fmtDate } from "@/lib/clip-ui";
import { uiSoundsEnabled, setUiSoundsEnabled } from "@/lib/ui-sound";

const STYLE_DESCRIPTIONS: Record<CaptionStyle, string> = {
  BOLD: "Big high-impact captions — the TikTok classic",
  CLEAN: "Minimal, understated captions",
  KLYP: "Branded style with the accent green keyword pop",
};

type SparkTransaction = {
  id: string;
  delta: number;
  reason: string;
  balance_after: number;
  created_at: string;
};

const TRANSACTION_LABELS: Record<string, string> = {
  opening_balance: "Starting balance",
  monthly_reset: "Allowance refill",
  checkout_grant: "Pro purchase",
  invoice_grant: "Pro payment",
  subscription_deleted: "Subscription ended",
  analysis: "VOD analysis and clips",
  auto_clip: "Automatic clip analysis",
  manual_adjustment: "Balance adjustment",
};

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-xl p-6">
      <h2 className="font-syne text-lg font-semibold text-foreground">{title}</h2>
      {desc && <p className="text-sm text-foreground-muted mt-0.5 mb-5">{desc}</p>}
      {!desc && <div className="mb-5" />}
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { tier, balance } = useSparks();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [handle, setHandle] = useState("");
  const [defaultStyle, setDefaultStyle] = useState<CaptionStyle>("BOLD");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uiSounds, setUiSounds] = useState(false);
  const [transactions, setTransactions] = useState<SparkTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      setName(data.user.user_metadata?.full_name ?? (data.user.email ?? "").split("@")[0]);
      setProvider(data.user.app_metadata?.provider ?? "email");
    });
    supabase.rpc("get_profile").then(({ data }) => {
      if (data) setProfile(data as Profile);
    });
    supabase.from("spark_transactions")
      .select("id,delta,reason,balance_after,created_at")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) setTransactionsError(true);
        else setTransactions((data ?? []) as SparkTransaction[]);
        setTransactionsLoading(false);
      });

    setUiSounds(uiSoundsEnabled());
    setHandle(localStorage.getItem("klyp-handle") ?? "");
    const storedStyle = localStorage.getItem("klyp-default-style");
    if (storedStyle && (CAPTION_STYLES as readonly string[]).includes(storedStyle)) {
      setDefaultStyle(storedStyle as CaptionStyle);
    }
  }, []);

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const updateHandle = (value: string) => {
    const clean = value.replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 25);
    setHandle(clean);
    localStorage.setItem("klyp-handle", clean);
    flashSaved();
  };

  const updateStyle = (style: CaptionStyle) => {
    setDefaultStyle(style);
    localStorage.setItem("klyp-default-style", style);
    flashSaved();
  };

  const updateUiSounds = (on: boolean) => {
    setUiSounds(on);
    setUiSoundsEnabled(on);
    flashSaved();
  };

  const signOut = async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  const allowance = SPARKS_ALLOWANCE[tier];
  const used = balance !== null ? Math.max(0, allowance - balance) : 0;

  return (
    <div className="p-8 max-w-3xl mx-auto animate-fade-in">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-syne text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-foreground-muted mt-1 text-sm">Your account, defaults, and plan.</p>
        </div>
        {saved && (
          <span className="px-3 py-1.5 rounded-full bg-accent-glow border border-accent/30 text-accent text-xs font-bold font-syne animate-fade-in">
            ✓ Saved
          </span>
        )}
      </header>

      <div className="space-y-6">
        {/* Account */}
        <Section title="Account">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xl font-bold font-syne flex-shrink-0">
              {(name[0] ?? "?").toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-semibold text-foreground truncate">{name || "—"}</p>
              <p className="text-sm text-foreground-muted truncate">{email || "—"}</p>
              <p className="text-xs text-subtle mt-0.5 capitalize">Signed in with {provider}</p>
            </div>
            <button
              onClick={signOut}
              disabled={signingOut}
              className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground-muted hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-colors disabled:opacity-50"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </Section>

        {/* Clip defaults */}
        <Section
          title="Clip Defaults"
          desc="Applied to every clip you export — change them per-clip anytime."
        >
          <div className="space-y-6">
            <div>
              <label htmlFor="settings-handle" className="block text-xs font-medium text-foreground-muted mb-1.5">
                Streamer handle
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center px-3.5 py-2.5 rounded-lg bg-surface-2 border border-border focus-within:border-accent transition-colors w-56">
                  <span className="text-sm text-subtle">@</span>
                  <input
                    id="settings-handle"
                    type="text"
                    value={handle}
                    onChange={(e) => updateHandle(e.target.value)}
                    placeholder="yourname"
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-subtle focus:outline-none min-w-0"
                  />
                </div>
              </div>
              <p className="text-xs text-subtle mt-1.5">
                {handle
                  ? `@${handle} gets burned into the top-right corner of every export.`
                  : "Optional — burned into the corner of your exported clips."}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-foreground-muted mb-2">Default caption style</p>
              <div className="grid grid-cols-3 gap-2">
                {CAPTION_STYLES.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStyle(s)}
                    className={`py-2.5 rounded-lg border text-xs font-bold font-syne transition-colors ${
                      defaultStyle === s
                        ? "bg-accent-glow border-accent/50 text-accent"
                        : "bg-surface-2 border-border text-foreground-muted hover:border-subtle"
                    }`}
                  >
                    {s === "KLYP" ? "⚡ KLYP" : s}
                  </button>
                ))}
              </div>
              <p className="text-xs text-subtle mt-1.5">{STYLE_DESCRIPTIONS[defaultStyle]}</p>
            </div>
          </div>
        </Section>

        {/* Interface */}
        <Section
          title="Interface"
          desc="How the dashboard itself behaves."
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Interface sounds</p>
              <p className="text-xs text-foreground-muted mt-1 leading-relaxed">
                A short cue when a clip preview opens. Off by default. No sound file ships
                with Klyp yet, so turning this on stays silent until one is added.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={uiSounds}
              aria-label="Interface sounds"
              onClick={() => updateUiSounds(!uiSounds)}
              className={`flex-shrink-0 w-11 h-6 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${
                uiSounds ? "bg-accent-glow border-accent/50" : "bg-surface-2 border-border"
              }`}
            >
              <span
                className={`block w-4 h-4 rounded-full transition-transform ${
                  uiSounds ? "translate-x-6 bg-accent" : "translate-x-1 bg-foreground-muted"
                }`}
              />
            </button>
          </div>
        </Section>

        {/* Plan & billing */}
        <Section title="Plan & Billing">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold font-syne tracking-wide ${
                  tier === "pro"
                    ? "bg-accent text-background"
                    : "bg-surface-2 border border-border text-foreground-muted"
                }`}
              >
                {tier === "pro" ? "⚡ PRO" : "FREE"}
              </span>
              <span className="text-sm text-foreground-muted">
                {tier === "pro" ? "$28/mo · no watermark · 500 ⚡/mo" : "150 ⚡ every 30 days · watermarked exports"}
              </span>
            </div>
            <UpgradeButton />
          </div>

          {/* Sparks usage */}
          <div className="p-4 rounded-lg bg-surface-2 border border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted">
                <SparkIcon size={12} className="text-accent" />
                Sparks this cycle
              </span>
              <span className="text-xs text-foreground-muted">
                <span className="font-syne font-bold text-foreground">{balance ?? "—"}</span> / {allowance} left
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: balance !== null ? `${Math.min(100, (balance / allowance) * 100)}%` : "0%" }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-[11px] text-subtle">{used} ⚡ used</p>
              {profile && (
                <p className="text-[11px] text-subtle">
                  {tier === "pro" ? "Next period, pending payment" : "Refills"} {fmtDate(profile.sparks_reset_at)}
                </p>
              )}
            </div>
          </div>
        </Section>

        <Section title="Sparks history" desc="Your 50 most recent Sparks transactions.">
          {transactionsLoading ? (
            <p className="text-sm text-foreground-muted">Loading history…</p>
          ) : transactionsError ? (
            <p role="alert" className="text-sm text-red-400">Could not load Sparks history. Refresh to try again.</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-foreground-muted">No Sparks transactions yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {transactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-foreground">{TRANSACTION_LABELS[transaction.reason] ?? transaction.reason.replace(/_/g, " ")}</p>
                    <p className="text-xs text-subtle">{new Date(transaction.created_at).toLocaleString()} · {transaction.balance_after} ⚡ left</p>
                  </div>
                  <span className={transaction.delta >= 0 ? "text-accent font-semibold" : "text-foreground font-semibold"}>
                    {transaction.delta > 0 ? "+" : ""}{transaction.delta} ⚡
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
