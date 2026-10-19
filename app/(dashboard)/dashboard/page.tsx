import AnalyzePanel from "@/components/AnalyzePanel";
import SparksBalance from "@/components/SparksBalance";
import UpgradeButton from "@/components/UpgradeButton";
import SavedClips from "@/components/SavedClips";
import ConnectStreamBanner from "@/components/ConnectStreamBanner";
import DashboardStats from "@/components/DashboardStats";

export default function DashboardPage() {
  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-6 animate-fade-in font-geist">
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="font-geist text-3xl sm:text-4xl font-bold text-white">Dashboard</h1>
          <p className="text-[15px] text-foreground-muted mt-1">
            Paste a video link or connect your stream to find your best moments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SparksBalance />
          <UpgradeButton />
        </div>
      </header>

      {/* Replaces the old Quick Start checklist — same /dashboard/streams flow. */}
      <ConnectStreamBanner />

      <AnalyzePanel />

      <DashboardStats />

      <SavedClips />
    </div>
  );
}
