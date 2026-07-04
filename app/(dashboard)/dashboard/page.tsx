import AnalyzePanel from "@/components/AnalyzePanel";
import SparksBalance from "@/components/SparksBalance";
import UpgradeButton from "@/components/UpgradeButton";
import SavedClips from "@/components/SavedClips";

const statCards = [
  { label: "Clips Generated", value: "—", sub: "this month" },
  { label: "Hours Processed", value: "—", sub: "total" },
  { label: "Avg. Clip Score", value: "—", sub: "engagement" },
  { label: "Streams Connected", value: "—", sub: "active" },
];

export default function DashboardPage() {
  return (
    <div className="p-8 max-w-6xl mx-auto animate-fade-in">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-syne text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-foreground-muted mt-1 text-sm">
            Connect a stream to start generating clips automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SparksBalance />
          <UpgradeButton />
        </div>
      </header>

      <AnalyzePanel />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-surface border border-border rounded-xl p-5"
          >
            <p className="text-xs text-foreground-muted uppercase tracking-wider font-medium">
              {card.label}
            </p>
            <p className="font-syne text-3xl font-bold text-foreground mt-2">{card.value}</p>
            <p className="text-xs text-foreground-muted mt-1">{card.sub}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-4">Saved Clips</h2>
          <SavedClips />
        </div>

        <div className="bg-surface border border-border rounded-xl p-6">
          <h2 className="font-syne text-lg font-semibold text-foreground mb-4">Quick Start</h2>
          <ol className="space-y-4">
            {[
              "Connect your Twitch or YouTube account",
              "Choose your clip preferences and highlight types",
              "Go live — Klyp handles the rest automatically",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent-glow border border-accent/30 flex items-center justify-center text-accent text-xs font-bold font-syne">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground-muted pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <a
            href="/dashboard/streams"
            className="mt-6 block w-full py-2.5 rounded-lg bg-accent text-background text-sm font-semibold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm text-center"
          >
            Connect a Stream
          </a>
        </div>
      </section>
    </div>
  );
}
