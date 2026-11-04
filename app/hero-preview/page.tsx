import type { Metadata } from "next";
import BeforeAfterBand from "@/components/hero/BeforeAfterBand";

/** A private design preview of the new before and after band by itself. Not linked from the site; search engines skip it. */
export const metadata: Metadata = {
  title: "Hero preview",
  robots: { index: false, follow: false },
};

export default function HeroPreviewPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-foreground-muted">Preview only · not on the live site</p>
      <BeforeAfterBand />
    </main>
  );
}
