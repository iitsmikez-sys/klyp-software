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
import VerticalLayoutEditor from "@/components/VerticalLayoutEditor";
import type { VerticalLayoutV1 } from "@/lib/vertical-layout";

const STYLE_DESCRIPTIONS: Record<CaptionStyle, string> = {
  BOLD: "Big high-impact captions — the TikTok classic",
  CLEAN: "Minimal, understated captions",
  KLYP: "Branded style with the accent green keyword pop",
  PULSE: "Yellow captions pulse in with each phrase",
  SLIDE: "White captions slide into view",
  SPARK: "Green words flash in one at a time",
  BOUNCE: "Bold captions spring into place",
  GLOW: "Soft luminous captions fade in",
  COMIC: "Yellow comic captions pop onto the screen",
  KEYWORD: "One word turns green as each phrase plays",
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
  const { tier, balance, complimentaryPro } = useSparks();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [handle, setHandle] = useState("");
  const [defaultStyle, setDefaultStyle] = useState<CaptionStyle>("BOLD");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uiSounds, setUiSounds] = useState(false);
  const [verticalLayout, setVerticalLayout] = useState<VerticalLayoutV1 | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState("");

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

    setUiSounds(uiSoundsEnabled());
    fetch("/api/vertical-layout").then((response) => response.json()).then((data) => {
      if (data.layout) setVerticalLayout(data.layout);
      if (data.warning) setLayoutMessage(data.warning);
    }).catch(() => setLayoutMessage("Could not load your vertical layout."));
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

  const saveVerticalLayout = async (nextLayout: VerticalLayoutV1 | null = verticalLayout) => {
    setLayoutSaving(true);
    setLayoutMessage("");
    try {
      const response = await fetch("/api/vertical-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: nextLayout }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save layout.");
      setVerticalLayout(data.layout);
      setLayoutMessage(data.layout ? "Vertical layout saved for future clips." : "Full-frame view restored for future clips.");
    } catch (error) { setLayoutMessage(error instanceof Error ? error.message : "Could not save layout."); }
    finally { setLayoutSaving(false); }
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

        <Section title="Vertical stream layout" desc="Show gameplay, facecam and chat from your stream in a 9:16 clip. This is available on every plan.">
          <label className="block text-xs text-foreground-muted mb-3">Choose a sample recording from your device. It stays in your browser.
            <input type="file" accept="video/*" className="block mt-2 text-xs" onChange={(event) => {
              if (sampleUrl) URL.revokeObjectURL(sampleUrl);
              const file = event.target.files?.[0];
              setSampleUrl(file ? URL.createObjectURL(file) : null);
            }} />
          </label>
          <VerticalLayoutEditor sourceUrl={sampleUrl} layout={verticalLayout} onChange={setVerticalLayout} onSave={() => saveVerticalLayout()} saving={layoutSaving} />
          {verticalLayout && <button type="button" disabled={layoutSaving} onClick={() => saveVerticalLayout(null)} className="mt-3 text-xs text-foreground-muted underline disabled:opacity-50">Remove layout and show the full frame</button>}
          {layoutMessage && <p role="status" className="text-xs text-foreground-muted mt-2">{layoutMessage}</p>}
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
                {tier === "pro" ? complimentaryPro ? "Complimentary Pro · no charge · 500 ⚡/mo" : "$28/mo · no watermark · 500 ⚡/mo" : "60 ⚡/mo · watermarked exports"}
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
                <p className="text-[11px] text-subtle">Refills {fmtDate(profile.sparks_reset_at)}</p>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
