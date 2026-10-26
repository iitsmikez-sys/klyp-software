import AnalyzePanel from "@/components/AnalyzePanel";
import SparksBalance from "@/components/SparksBalance";
import UpgradeButton from "@/components/UpgradeButton";
import SavedClips from "@/components/SavedClips";
import ConnectStreamBanner from "@/components/ConnectStreamBanner";
import DashboardStats from "@/components/DashboardStats";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[1240px] space-y-8 px-4 py-6 font-geist sm:px-6 md:px-8 md:py-9">
      <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-geist text-3xl font-semibold tracking-tight text-white sm:text-4xl">Dashboard</h1>
          <p className="mt-2 text-[15px] text-foreground-muted">
            Start with a VOD. Review the moments Klyp finds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SparksBalance />
          <UpgradeButton />
        </div>
      </header>

      <AnalyzePanel />

      <SavedClips />

      <ConnectStreamBanner />

      <DashboardStats />
    </div>
  );
}
