import type { Metadata } from "next";
import VodBeforeCard from "@/components/hero/VodBeforeCard";
import LoadingDots from "@/components/hero/LoadingDots";
import ClipStack, { type HeroClip } from "@/components/hero/ClipStack";

/** A private design preview for the new hero. It is not linked from the site and search engines are told to skip it. */
export const metadata: Metadata = {
  title: "Hero preview",
  robots: { index: false, follow: false },
};

/** The scores are Klyp's real ones for these clips (not rounded up). */
const CLIPS: HeroClip[] = [
  { src: "/hero/clip-2.mp4", poster: "/hero/clip-2.jpg", label: "FUNNY", score: 66 },
  { src: "/hero/clip-1.mp4", poster: "/hero/clip-1.jpg", label: "RAGE", score: 69 },
  { src: "/hero/clip-3.mp4", poster: "/hero/clip-3.jpg", label: "FUNNY", score: 65 },
];

export default function HeroPreviewPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-foreground-muted">Preview only · not on the live site</p>
      <div className="flex w-full max-w-6xl flex-col items-center justify-center gap-8 lg:flex-row lg:gap-10">
        <VodBeforeCard />
        <LoadingDots />
        <ClipStack clips={CLIPS} />
      </div>
    </main>
  );
}
