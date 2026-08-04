import Link from "next/link";
import FadeIn from "./FadeIn";

/* ─── Icons ─── */
function CheckIcon() {
  return (
    <svg
      className="flex-shrink-0 mt-0.5"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#00E5A0"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg
      className="flex-shrink-0 mt-0.5"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#5a5a72"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.5" fill="#5a5a72" />
    </svg>
  );
}

/* ─── Types ─── */
type FeatureItem =
  | { kind: "check"; text: string }
  | { kind: "warn"; text: string }
  | { kind: "divider"; text: string };

type PriceDisplay =
  | { kind: "free" }
  | { kind: "fixed"; amount: string };

type Plan = {
  id: string;
  name: string;
  tagline: string;
  price: PriceDisplay;
  features: FeatureItem[];
  cta: { label: string; subtext?: string; href: string };
  highlighted?: boolean;
  badge?: string;
};

/* ─── Data ─── */
const plans: Plan[] = [
  {
    id: "free",
    name: "FREE",
    tagline: "Free forever",
    price: { kind: "free" },
    features: [
      { kind: "check", text: "60 Sparks per month" },
      { kind: "check", text: "AI clip detection with viral scores" },
      { kind: "check", text: "9:16 vertical exports at 1080×1920" },
      { kind: "check", text: "AI captions — BOLD, CLEAN & KLYP styles" },
      { kind: "check", text: "AI hook generator" },
      { kind: "warn",  text: "Moving klyp.world watermark on every clip" },
    ],
    cta: { label: "Create an account", href: "/login" },
  },
  {
    id: "pro",
    name: "PRO",
    tagline: "For streamers clipping every session",
    price: { kind: "fixed", amount: "$29" },
    features: [
      { kind: "check",   text: "500 Sparks per month — 8× more analyses" },
      { kind: "check",   text: "No watermark. Clean clips, your brand only" },
      { kind: "divider", text: "Everything in Free, plus:" },
      { kind: "check",   text: "Raw exports — edit clips yourself in CapCut" },
      { kind: "check",   text: "Every format — 9:16, 1:1 and 16:9" },
      { kind: "check",   text: "Streamer handle overlay on exports" },
      { kind: "check",   text: "Twitch chat spike detection" },
      { kind: "check",   text: "Download all clips as a ZIP" },
      { kind: "check",   text: "Priority support" },
    ],
    cta: { label: "Get Klyp Pro", subtext: "Cancel anytime", href: "/login" },
    highlighted: true,
    badge: "Most Popular",
  },
];

/* ─── Price renderer ─── */
function Price({ p }: { p: PriceDisplay }) {
  if (p.kind === "free") {
    return (
      <div className="flex items-end gap-1.5 min-h-[3.5rem]">
        <span className="font-syne text-4xl font-bold text-foreground">$0</span>
        <span className="text-sm text-foreground-muted mb-1.5">USD/mo</span>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-1.5 min-h-[3.5rem]">
      <span className="font-syne text-4xl font-bold text-accent">{p.amount}</span>
      <span className="text-sm text-foreground-muted mb-1.5">USD/mo</span>
    </div>
  );
}

/* ─── Feature row renderer ─── */
function FeatureRow({ item }: { item: FeatureItem }) {
  if (item.kind === "divider") {
    return (
      <li className="flex items-center gap-2 pt-2 pb-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[10px] font-semibold text-foreground-muted uppercase tracking-wider whitespace-nowrap">
          {item.text}
        </span>
        <div className="flex-1 h-px bg-border" />
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2.5">
      {item.kind === "check" ? <CheckIcon /> : <WarnIcon />}
      <span
        className={`text-sm leading-snug ${
          item.kind === "warn" ? "text-muted" : "text-foreground-muted"
        }`}
      >
        {item.text}
      </span>
    </li>
  );
}

/* ─── Section ─── */
export default function PricingSection() {
  return (
    <section id="pricing" className="px-4 sm:px-6 py-24 max-w-[90rem] mx-auto w-full">
      {/* Header */}
      <FadeIn>
        <div className="text-center mb-14">
          <p className="text-accent text-xs font-semibold font-syne uppercase tracking-widest mb-3">
            Pricing
          </p>
          <h2 className="font-syne text-4xl md:text-5xl font-bold text-foreground">
            Simple, honest pricing
          </h2>
          <p className="mt-4 text-foreground-muted max-w-md mx-auto text-sm">
            Start free. Upgrade when you&apos;re ready to grow.
          </p>
        </div>
      </FadeIn>

      {/* Cards grid: 1 col → 2 col (md) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start max-w-3xl mx-auto">
        {plans.map((plan, i) => {
          const isHighlighted = plan.highlighted;

          return (
            <FadeIn key={plan.id} delay={i * 0.09}>
              <div
                className={`relative flex flex-col rounded-2xl border p-6 transition-all duration-200 hover:-translate-y-1 ${
                  isHighlighted
                    ? "bg-surface border-accent/50 shadow-accent-glow md:-my-4 md:py-10"
                    : "bg-surface border-border hover:border-subtle"
                }`}
              >
                {/* Most Popular badge */}
                {plan.badge && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                    <span className="inline-flex items-center px-3 py-1 rounded-full bg-accent text-background text-[11px] font-bold font-syne tracking-wide whitespace-nowrap">
                      {plan.badge}
                    </span>
                  </div>
                )}

                {/* Plan header */}
                <div className="mb-5">
                  <p className={`font-syne text-xs font-bold uppercase tracking-[0.15em] mb-1 ${isHighlighted ? "text-accent" : "text-foreground-muted"}`}>
                    {plan.name}
                  </p>
                  <p className="text-xs text-foreground-muted leading-snug mb-4">{plan.tagline}</p>
                  <Price p={plan.price} />
                </div>

                {/* Divider */}
                <div className="h-px bg-border mb-5" />

                {/* Features */}
                <ul className="flex flex-col gap-2.5 flex-1 mb-7">
                  {plan.features.map((item, fi) => (
                    <FeatureRow key={fi} item={item} />
                  ))}
                </ul>

                {/* CTA */}
                <div className="flex flex-col items-center gap-1.5">
                  <Link
                    href={plan.cta.href}
                    className={`w-full text-center py-2.5 px-4 rounded-xl text-sm font-bold font-syne transition-colors ${
                      isHighlighted
                        ? "bg-accent text-background hover:bg-accent-dim shadow-accent-glow-sm"
                        : "bg-surface-2 border border-border text-foreground hover:border-subtle"
                    }`}
                  >
                    {plan.cta.label}
                  </Link>
                  {plan.cta.subtext && (
                    <p className="text-[11px] text-foreground-muted">{plan.cta.subtext}</p>
                  )}
                </div>
              </div>
            </FadeIn>
          );
        })}
      </div>
    </section>
  );
}
