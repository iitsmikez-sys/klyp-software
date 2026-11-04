import type { Metadata } from "next";
import VodBeforeCard from "@/components/hero/VodBeforeCard";
import LoadingDots from "@/components/hero/LoadingDots";

/** A private design preview for the new hero. It is not linked from the site and search engines are told to skip it. */
export const metadata: Metadata = {
  title: "Hero preview",
  robots: { index: false, follow: false },
};

export default function HeroPreviewPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-foreground-muted">Preview only · not on the live site</p>
      <div className="flex w-full max-w-5xl flex-col items-center justify-center gap-8 lg:flex-row lg:gap-10">
        <VodBeforeCard />
        <LoadingDots />
        {/* The clips go here next. */}
        <div className="flex h-[250px] w-[150px] shrink-0 items-center justify-center rounded-2xl border border-dashed border-border px-4 text-center text-xs text-foreground-muted">
          The 3 clips go here
        </div>
      </div>
    </main>
  );
}
