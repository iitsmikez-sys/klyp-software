import AnalyzePanel from "@/components/AnalyzePanel";
import SparksBalance from "@/components/SparksBalance";
import UpgradeButton from "@/components/UpgradeButton";
import SavedClips from "@/components/SavedClips";
import ConnectStreamBanner from "@/components/ConnectStreamBanner";
import DashboardStats from "@/components/DashboardStats";

export default function DashboardPage() {
  return (
    <div className="w-full max-w-[1480px] space-y-6 px-4 pb-10 pt-6 font-geist sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-geist text-2xl font-semibold tracking-tight text-white sm:text-[29px]">Create clips from your streams</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            Add a VOD and let Klyp find your best moments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
