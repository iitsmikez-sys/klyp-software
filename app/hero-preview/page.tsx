import type { Metadata } from "next";
import VodBeforeCard from "@/components/hero/VodBeforeCard";

/** A private design preview for the new hero. It is not linked from the site and search engines are told to skip it. */
export const metadata: Metadata = {
  title: "Hero preview",
  robots: { index: false, follow: false },
};

export default function HeroPreviewPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-foreground-muted">Preview only · not on the live site</p>
      <VodBeforeCard />
    </main>
  );
}
