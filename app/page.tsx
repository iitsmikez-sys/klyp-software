import Link from "next/link";
import Logo from "@/components/Logo";
import FadeIn from "@/components/FadeIn";
import FAQ from "@/components/FAQ";
import PricingSection from "@/components/PricingSection";
import Hero3D from "@/components/Hero3D";
import Stars from "@/components/Stars";
import { SPARKS_ALLOWANCE } from "@/lib/tier";
import Waitlist from "@/components/Waitlist";
import AmbientAudio from "@/components/AmbientAudio";
import NavButtons from "@/components/NavButtons";

/* ─── Features ───
 * Descriptions stay short here; each one states only what the product does
 * today. Anything not yet built carries a badge rather than present tense. */
const features: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  /** Small, concrete preview of the feature — real vocabulary, no mock metrics. */
  preview: React.ReactNode;
  cta?: { label: string; href: string };
  badge?: string;
}[] = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4l3 3" />
      </svg>
    ),
    title: "AI moment detection",
    desc: "Klyp reads the whole transcript and hands back your most clippable moments, each scored out of 100.",
    preview: (
      <div className="flex items-center gap-2">
        {[
          ["FUNNY", "bg-sky-500/15 text-sky-400 border-sky-500/30"],
          ["CLUTCH", "bg-amber-500/15 text-amber-400 border-amber-500/30"],
          ["FAIL", "bg-orange-500/15 text-orange-400 border-orange-500/30"],
        ].map(([label, style]) => (
          <span key={label} className={`px-2 py-0.5 rounded border text-[10px] font-bold tracking-wide ${style}`}>
            {label}
          </span>
        ))}
      </div>
    ),
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </svg>
    ),
    title: "Auto captions",
    desc: "Word-level captions burned into the video. Pro includes eight original editor styles and font choices.",
    preview: (
      <div className="flex items-center gap-2">
        {["BOLD", "CLEAN", "⚡ KLYP"].map((s, i) => (
          <span
            key={s}
            className={`px-2 py-0.5 rounded border text-[10px] font-bold tracking-wide ${
              i === 0 ? "bg-accent-glow border-accent/50 text-accent" : "border-border text-foreground-muted"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
    ),
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    title: "Hook generator",
    desc: "Three AI-written opening lines per clip. Pick one and it's burned over the first seconds.",
    preview: (
      <div className="space-y-1">
        {["Option 1", "Option 2", "Option 3"].map((o, i) => (
          <div
            key={o}
            className={`h-1.5 rounded-full ${i === 0 ? "bg-accent/70 w-3/4" : "bg-border w-1/2"}`}
          />
        ))}
      </div>
    ),
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: "Every aspect ratio",
    desc: "One clip, exported 9:16, 1:1 or 16:9 — or left at the source's own ratio.",
    preview: (
      <div className="flex items-end gap-2">
        {[
          ["9:16", "w-4 h-7"],
          ["1:1", "w-6 h-6"],
          ["16:9", "w-9 h-5"],
        ].map(([label, size]) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <div className={`${size} rounded border border-accent/40 bg-accent-glow`} />
            <span className="text-[9px] font-mono text-foreground-muted">{label}</span>
          </div>
        ))}
      </div>
    ),
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: "Your clipping stats",
    desc: "Average viral score, your most common clip types, and weekly output in one view.",
    preview: (
      <div className="flex items-end gap-1.5 h-9">
        {[40, 70, 55, 90, 65, 80].map((h, i) => (
          <div key={i} className="flex-1 rounded-sm bg-accent/50" style={{ height: `${h}%` }} />
        ))}
      </div>
    ),
    cta: { label: "See your stats", href: "/dashboard/analytics" },
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2H3v16h5v4l4-4h5l4-4V2z" />
      </svg>
    ),
    title: "Analyze a VOD",
    desc: "Paste a YouTube or Twitch VOD link to find clips from the recording.",
    preview: (
      <div className="flex items-center gap-2 text-[11px] text-foreground-muted">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        Ready for a VOD link
      </div>
    ),
    cta: { label: "Analyze a VOD", href: "/dashboard" },
    badge: "YouTube and Twitch VODs",
  },
];

/* ─── Steps for the VOD analysis flow. */
const steps = [
  {
    num: "01",
    title: "Paste your VOD",
    desc: "Add a YouTube or Twitch VOD link in your dashboard.",
    visual: (
      <div className="flex items-center justify-center gap-2">
        <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 text-[11px] font-bold">
          VOD link
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00E5A0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    ),
  },
  {
    num: "02",
    title: "Review the moments",
    desc: "Klyp analyzes the recording and suggests clips for you to review.",
    visual: (
      <div className="flex items-center justify-center gap-2">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[11px] font-bold text-foreground-muted tracking-wide">REVIEW</span>
      </div>
    ),
  },
  {
    num: "03",
    title: "Save and export",
    desc: "Keep the clips you like, then download them from your dashboard.",
    visual: (
      <div className="flex items-center justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-4 h-7 rounded border border-accent/40 bg-accent-glow"
            style={{ opacity: 1 - i * 0.25 }}
          />
        ))}
      </div>
    ),
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-geist">
      <AmbientAudio />

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between gap-4 px-5 sm:px-8 h-16 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <Logo size="md" />
        </div>

        <div className="hidden md:flex items-center gap-7">
          {[
            ["Features", "#features"],
            ["How it works", "#how-it-works"],
            ["Pricing", "#pricing"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="text-[15px] text-foreground-muted hover:text-foreground transition-colors"
            >
              {label}
            </a>
          ))}
        </div>

        <NavButtons />
      </nav>

      {/* ── Hero — the 3D play button, particles and grid floor live here ── */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-24 pb-20 overflow-hidden">
        <Hero3D />
        {/* Readability scrim: darkens the animation directly behind the copy
            without flattening the glow at the edges of the section. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 42%, rgba(6,6,8,0.88) 0%, rgba(6,6,8,0.6) 45%, rgba(6,6,8,0) 100%)",
          }}
        />

        <div className="relative z-10 flex flex-col items-center w-full">
          <FadeIn delay={0}>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-glow border border-accent/20 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span className="text-accent text-[13px] font-medium tracking-wide">
                AI-powered clipping for streamers
              </span>
            </div>
          </FadeIn>

          <FadeIn delay={0.08}>
            <h1 className="font-geist text-5xl md:text-7xl font-bold text-white leading-[1.05] tracking-tight text-balance max-w-4xl">
              Your best moments,{" "}
              <span className="text-accent">ready to find</span>
            </h1>
          </FadeIn>

          <FadeIn delay={0.16}>
            <p className="mt-6 text-lg md:text-xl text-foreground-muted max-w-2xl text-balance leading-relaxed">
              Paste a YouTube or Twitch VOD link and let Klyp suggest moments
              you can review, save, and export.
            </p>
          </FadeIn>

          <FadeIn delay={0.22}>
            <div className="flex flex-col sm:flex-row items-center gap-4 mt-10">
              <Link
                href="/login"
                className="px-7 py-3.5 rounded-xl bg-accent text-background text-base font-bold hover:bg-accent-dim transition-colors shadow-accent-glow"
              >
                Start clipping for free
              </Link>
              <Link
                href="/dashboard"
                className="px-7 py-3.5 rounded-xl bg-surface-2/90 backdrop-blur-sm border border-border text-foreground text-base font-medium hover:border-subtle transition-colors"
              >
                View demo dashboard →
              </Link>
            </div>
          </FadeIn>

          <FadeIn delay={0.28}>
            <p className="mt-4 text-sm text-foreground-muted">
              No credit card required. Free plan includes {SPARKS_ALLOWANCE.free} Sparks every 30 days.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── What Klyp saves creators ── */}
      <section className="relative border-t border-border px-6 py-16 sm:py-20">
        <FadeIn className="mx-auto max-w-3xl text-center">
          <h2 className="font-geist text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Spend less time searching. More time posting.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base text-foreground-muted leading-relaxed">
            Drop in a Twitch or YouTube VOD. Klyp surfaces moments you can
            review, edit, and export as vertical clips.
          </p>
        </FadeIn>
      </section>

      {/* ── How it works ── */}
      <section
        id="how-it-works"
        className="relative px-6 py-24 bg-surface border-y border-border overflow-hidden scroll-mt-16"
      >
        <Stars density={0.7} />
        <div className="relative z-10 max-w-5xl mx-auto w-full">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-accent text-[13px] font-semibold uppercase tracking-widest mb-3">
                How it works
              </p>
              <h2 className="font-geist text-4xl md:text-5xl font-bold text-white tracking-tight">
                From VOD to clips
              </h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.12}>
                <div className="h-full flex flex-col rounded-2xl bg-background/80 backdrop-blur-sm border border-border p-6">
                  <div className="flex items-center justify-between mb-5">
                    <span className="w-11 h-11 rounded-xl bg-accent-glow border border-accent/20 flex items-center justify-center font-geist text-base font-bold text-accent">
                      {step.num}
                    </span>
                    {step.visual}
                  </div>
                  <h3 className="font-geist text-lg font-semibold text-white mb-2">{step.title}</h3>
                  <p className="text-[15px] text-foreground-muted leading-relaxed">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="relative px-6 py-24 w-full overflow-hidden scroll-mt-16">
        <Stars />
        <div className="relative z-10 max-w-6xl mx-auto w-full">
          <FadeIn>
            <div className="text-center mb-14">
              <p className="text-accent text-[13px] font-semibold uppercase tracking-widest mb-3">
                Features
              </p>
              <h2 className="font-geist text-4xl md:text-5xl font-bold text-white tracking-tight">
                Everything you need to grow
              </h2>
              <p className="mt-4 text-base text-foreground-muted max-w-xl mx-auto">
                Paste a VOD link to find moments, then choose what to save and export.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.07}>
                <div className="lift h-full flex flex-col bg-surface/95 backdrop-blur-sm border border-border rounded-2xl p-6 hover:border-accent/30 group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-accent-glow flex items-center justify-center text-accent group-hover:shadow-accent-glow-sm transition-shadow">
                      {f.icon}
                    </div>
                    {f.badge && (
                      <span className="px-2 py-1 rounded-full bg-surface-2 border border-border text-[10px] font-bold text-foreground-muted uppercase tracking-wide">
                        {f.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="font-geist text-lg font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-[15px] text-foreground-muted leading-relaxed flex-1">{f.desc}</p>

                  {/* Product preview strip */}
                  <div className="mt-5 pt-4 border-t border-border min-h-[46px] flex items-center">
                    {f.preview}
                  </div>

                  {f.cta && (
                    <Link
                      href={f.cta.href}
                      className="inline-flex items-center gap-1 mt-4 text-[15px] font-bold text-accent hover:gap-2 transition-all"
                    >
                      {f.cta.label} →
                    </Link>
                  )}
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <div id="pricing" className="scroll-mt-16">
        <PricingSection />
      </div>

      {/* ── FAQ ── */}
      <section className="px-6 py-24 bg-surface border-y border-border">
        <div className="max-w-3xl mx-auto w-full">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-accent text-[13px] font-semibold uppercase tracking-widest mb-3">
                FAQ
              </p>
              <h2 className="font-geist text-4xl md:text-5xl font-bold text-white tracking-tight">
                Common questions
              </h2>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <FAQ />
          </FadeIn>
        </div>
      </section>

      {/* ── Waitlist ── */}
      <Waitlist />

      {/* ── Final CTA ── */}
      <section className="px-6 py-32 relative overflow-hidden">
        <Stars density={0.8} />
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[400px] rounded-full bg-accent opacity-[0.06] blur-[120px]" />
        </div>

        <FadeIn className="relative z-10 text-center max-w-3xl mx-auto">
          <h2 className="font-geist text-4xl md:text-6xl font-bold text-white leading-tight tracking-tight mb-6">
            Start turning streams into{" "}
            <span className="text-accent">viral clips</span> today
          </h2>
          <p className="text-foreground-muted text-lg mb-10 max-w-xl mx-auto leading-relaxed">
            Paste your first VOD and see what Klyp pulls out of it. The free plan
            includes {SPARKS_ALLOWANCE.free} Sparks every 30 days — no credit card needed.
          </p>
          <Link
            href="/login"
            className="inline-block px-8 py-4 rounded-2xl bg-accent text-background text-base font-bold hover:bg-accent-dim transition-colors shadow-accent-glow"
          >
            Get started for free →
          </Link>
          <p className="mt-4 text-sm text-foreground-muted">
            Free forever · No credit card · Cancel anytime
          </p>
        </FadeIn>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-6 sm:px-8 py-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-2">
            <Logo size="sm" />
          </div>
          <div className="flex items-center gap-6 text-sm text-foreground-muted">
            {[
              ["Features", "#features"],
              ["How it works", "#how-it-works"],
              ["Pricing", "#pricing"],
              ["Privacy", "/privacy"],
            ].map(([label, href]) => (
              <a key={label} href={href} className="hover:text-foreground transition-colors">
                {label}
              </a>
            ))}
          </div>
          <p className="text-sm text-foreground-muted">© 2026 Klyp. All rights reserved.</p>
        </div>
        <p className="max-w-6xl mx-auto mt-5 text-xs text-subtle text-center md:text-left">
          Music: &quot;Floating Cities&quot; by Kevin MacLeod (incompetech.com) — Licensed under CC BY 4.0
        </p>
      </footer>
    </div>
  );
}
