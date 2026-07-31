import Link from "next/link";
import Image from "next/image";
import Logo from "@/components/Logo";
import FadeIn from "@/components/FadeIn";
import FAQ from "@/components/FAQ";
import PricingSection from "@/components/PricingSection";
import Hero3D from "@/components/Hero3D";
import Stars from "@/components/Stars";
import Equalizer from "@/components/Equalizer";
import Waitlist from "@/components/Waitlist";
import AmbientAudio from "@/components/AmbientAudio";
import NavButtons from "@/components/NavButtons";

/* ─── Features ─── */
const features: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  cta?: { label: string; href: string };
  badge?: string;
}[] = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4l3 3" />
      </svg>
    ),
    title: "AI Viral Moment Detection",
    desc: "Paste a VOD link and Klyp's AI scans the whole stream — transcript plus Twitch chat spikes — and hands you the 5 most clippable moments, scored out of 100.",
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
      </svg>
    ),
    title: "Auto Captions",
    desc: "Word-perfect captions burned straight into the video in 3 caption styles — BOLD, CLEAN, and the Klyp signature green. Preview before you export.",
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
    ),
    title: "Hook Generator",
    desc: "Every clip comes with 3 AI-written opening hooks built to stop the scroll. Pick your favorite and it's burned over the first seconds of the clip.",
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: "Multi-Platform Export",
    desc: "One clip, three formats: 9:16 vertical for TikTok, Reels & Shorts, 1:1 square for the Instagram feed, and 16:9 for YouTube. Pick per clip before you download.",
    cta: { label: "Try it now", href: "/dashboard" },
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: "Creator Analytics",
    desc: "Track everything you've clipped — viral score averages, your most common clip types, weekly output, and your top performers, all in one view.",
    cta: { label: "See your stats", href: "/dashboard/analytics" },
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2H3v16h5v4l4-4h5l4-4V2z" />
      </svg>
    ),
    title: "Workflow Automation",
    desc: "Connect your Twitch or YouTube channel and Klyp will auto-clip every new VOD the moment it drops — no pasting links, ever.",
    cta: { label: "Connect your channel", href: "/dashboard/streams" },
    badge: "Coming soon",
  },
];

/* ─── Steps ─── */
const steps = [
  {
    num: "01",
    title: "Connect your channel",
    desc: "Link your Twitch, YouTube, or Kick account in under 60 seconds. No downloads, no OBS plugins.",
  },
  {
    num: "02",
    title: "Stream like you always do",
    desc: "Klyp runs server-side. There's nothing to install or remember — just go live and play your game.",
  },
  {
    num: "03",
    title: "Wake up to your best clips",
    desc: "After your stream, your top moments are clipped, trimmed, and waiting in your dashboard — ready to post.",
  },
];


export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AmbientAudio />

      {/* ── Nav ── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-8 h-16 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <Image
            src="/mascot.png"
            alt=""
            width={480}
            height={460}
            priority
            className="h-7 w-auto sm:h-8 md:h-9 select-none"
          />
          <Logo size="md" />
        </div>
        <NavButtons />
      </nav>

      {/* ── Hero ── */}
      <section className="relative flex flex-col items-center justify-center text-center px-6 pt-28 pb-24 overflow-hidden">
        <Hero3D />
        <div className="relative z-10 flex flex-col items-center w-full">
        <FadeIn delay={0}>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-glow border border-accent/20 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <span className="text-accent text-xs font-medium font-syne tracking-wide">
              AI-powered clipping for streamers
            </span>
          </div>
        </FadeIn>

        <FadeIn delay={0.08}>
          <h1 className="font-syne text-5xl md:text-7xl font-bold text-foreground leading-tight text-balance max-w-4xl">
            Your best moments,{" "}
            <span className="text-accent">clipped automatically</span>
          </h1>
        </FadeIn>

        <FadeIn delay={0.16}>
          <p className="mt-6 text-lg text-foreground-muted max-w-xl text-balance">
            Klyp watches your streams in real time and uses AI to find, cut, and
            export your most engaging clips — so you can focus on playing.
          </p>
        </FadeIn>

        <FadeIn delay={0.22}>
          <div className="flex flex-col sm:flex-row items-center gap-4 mt-10">
            <Link
              href="/login"
              className="px-6 py-3 rounded-xl bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow"
            >
              Start clipping for free
            </Link>
            <Link
              href="/dashboard"
              className="px-6 py-3 rounded-xl bg-surface-2 border border-border text-foreground text-sm font-medium hover:border-subtle transition-colors"
            >
              View demo dashboard →
            </Link>
          </div>
        </FadeIn>

        {/* Mock preview */}
        <FadeIn delay={0.3} className="mt-20 w-full max-w-5xl">
          <div className="rounded-2xl bg-surface border border-border overflow-hidden shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-2">
              <span className="w-3 h-3 rounded-full bg-border" />
              <span className="w-3 h-3 rounded-full bg-border" />
              <span className="w-3 h-3 rounded-full bg-border" />
              <span className="ml-3 text-xs text-foreground-muted">klyp.app/dashboard</span>
            </div>
            <div className="flex h-64">
              <div className="w-48 border-r border-border bg-surface p-4 flex flex-col gap-2">
                {["Dashboard", "My Clips", "Streams", "Analytics"].map((item) => (
                  <div
                    key={item}
                    className={`h-8 rounded-lg px-3 flex items-center text-xs ${
                      item === "Dashboard" ? "bg-accent-glow text-accent" : "text-foreground-muted"
                    }`}
                  >
                    {item}
                  </div>
                ))}
              </div>
              <div className="flex-1 p-6 grid grid-cols-4 gap-3 content-start">
                {["Clips", "Hours", "Score", "Streams"].map((label) => (
                  <div key={label} className="bg-surface-2 border border-border rounded-xl p-3">
                    <p className="text-xs text-foreground-muted">{label}</p>
                    <p className="font-syne text-2xl font-bold text-foreground mt-1">—</p>
                  </div>
                ))}
                <div className="col-span-4 bg-surface-2 border border-border rounded-xl p-4 flex items-center justify-center gap-5">
                  <Equalizer className="hidden sm:flex flex-1 max-w-[160px]" />
                  <p className="text-xs text-foreground-muted whitespace-nowrap">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse mr-2 align-middle" />
                    Analyzing stream audio…
                  </p>
                  <Equalizer className="hidden sm:flex flex-1 max-w-[160px]" />
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
        </div>
      </section>

      {/* ── Trusted by bar ── */}
      <FadeIn>
        <div className="border-y border-border py-8 px-6">
          <p className="text-center text-xs text-foreground-muted uppercase tracking-widest mb-6 font-medium">
            Trusted by streamers on
          </p>
          <div className="flex items-center justify-center gap-12 flex-wrap opacity-40">
            {["Twitch", "YouTube", "Kick", "TikTok"].map((name) => (
              <span key={name} className="font-syne font-bold text-lg text-foreground">
                {name}
              </span>
            ))}
          </div>
        </div>
      </FadeIn>

      {/* ── Features ── */}
      <section className="relative px-6 py-24 w-full overflow-hidden">
        <Stars />
        <div className="relative z-10 max-w-6xl mx-auto w-full">
        <FadeIn>
          <div className="text-center mb-16">
            <p className="text-accent text-xs font-semibold font-syne uppercase tracking-widest mb-3">
              Features
            </p>
            <h2 className="font-syne text-4xl md:text-5xl font-bold text-foreground">
              Everything you need to grow
            </h2>
            <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
              Stop clipping manually. Klyp handles the whole pipeline — from detection to export.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <FadeIn key={f.title} delay={i * 0.07}>
              <div className="lift h-full flex flex-col bg-surface border border-border rounded-2xl p-6 hover:border-accent/30 group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-accent-glow flex items-center justify-center text-accent group-hover:shadow-accent-glow-sm transition-shadow">
                    {f.icon}
                  </div>
                  {f.badge && (
                    <span className="px-2 py-1 rounded-full bg-surface-2 border border-border text-[10px] font-bold font-syne text-foreground-muted uppercase tracking-wide">
                      {f.badge}
                    </span>
                  )}
                </div>
                <h3 className="font-syne text-base font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-foreground-muted leading-relaxed flex-1">{f.desc}</p>
                {f.cta && (
                  <Link
                    href={f.cta.href}
                    className="inline-flex items-center gap-1 mt-4 text-sm font-bold font-syne text-accent hover:gap-2 transition-all"
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

      {/* ── How it works ── */}
      <section className="relative px-6 py-24 bg-surface border-y border-border overflow-hidden">
        <Stars density={0.7} />
        <div className="relative z-10 max-w-5xl mx-auto w-full">
          <FadeIn>
            <div className="text-center mb-16">
              <p className="text-accent text-xs font-semibold font-syne uppercase tracking-widest mb-3">
                How it works
              </p>
              <h2 className="font-syne text-4xl md:text-5xl font-bold text-foreground">
                Set up in 60 seconds
              </h2>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* connector line — desktop only */}
            <div className="hidden md:block absolute top-8 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px bg-gradient-to-r from-border via-accent/30 to-border" />

            {steps.map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.12}>
                <div className="flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-accent-glow border border-accent/20 flex items-center justify-center mb-6 relative z-10">
                    <span className="font-syne text-xl font-bold text-accent">{step.num}</span>
                  </div>
                  <h3 className="font-syne text-lg font-semibold text-foreground mb-3">{step.title}</h3>
                  <p className="text-sm text-foreground-muted leading-relaxed">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <PricingSection />

      {/* ── FAQ ── */}
      <section className="px-6 py-24 bg-surface border-y border-border">
        <div className="max-w-3xl mx-auto w-full">
          <FadeIn>
            <div className="text-center mb-12">
              <p className="text-accent text-xs font-semibold font-syne uppercase tracking-widest mb-3">
                FAQ
              </p>
              <h2 className="font-syne text-4xl md:text-5xl font-bold text-foreground">
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
        {/* radial glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[400px] rounded-full bg-accent opacity-[0.06] blur-[120px]" />
        </div>

        <FadeIn className="relative z-10 text-center max-w-3xl mx-auto">
          <h2 className="font-syne text-4xl md:text-6xl font-bold text-foreground leading-tight mb-6">
            Start turning streams into{" "}
            <span className="text-accent">viral clips</span> today
          </h2>
          <p className="text-foreground-muted text-lg mb-10 max-w-xl mx-auto">
            Join thousands of streamers using Klyp to grow their audience on
            autopilot. No credit card required.
          </p>
          <Link
            href="/login"
            className="inline-block px-8 py-4 rounded-2xl bg-accent text-background text-base font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow"
          >
            Get started for free →
          </Link>
          <p className="mt-4 text-xs text-foreground-muted">
            Free forever · No credit card · Cancel anytime
          </p>
        </FadeIn>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border px-8 py-8">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <div className="flex items-center gap-6 text-xs text-foreground-muted">
            {["Privacy", "Terms", "Status", "Twitter / X"].map((l) => (
              <a key={l} href="#" className="hover:text-foreground transition-colors">
                {l}
              </a>
            ))}
          </div>
          <p className="text-xs text-foreground-muted">© 2026 Klyp. All rights reserved.</p>
        </div>
        <p className="max-w-6xl mx-auto mt-4 text-[10px] text-subtle text-center md:text-left">
          Music: &quot;Floating Cities&quot; by Kevin MacLeod (incompetech.com) — Licensed under CC BY 4.0
        </p>
      </footer>
    </div>
  );
}
