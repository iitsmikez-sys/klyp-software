import VodBeforeCard from "./VodBeforeCard";
import LoadingDots from "./LoadingDots";
import ClipStack, { type HeroClip } from "./ClipStack";

/**
 * PLACEHOLDER scores for the design preview only (82, 92, 78). Klyp's own scores for these moments were 66, 69 and 65.
 * Before this goes on the live site, show scores Klyp really gave these clips, or find clips that really score this high.
 */
export const HERO_CLIPS: HeroClip[] = [
  { src: "/hero/clip-2.mp4", poster: "/hero/clip-2.jpg", label: "FUNNY", score: 82 },
  { src: "/hero/clip-1.mp4", poster: "/hero/clip-1.jpg", label: "RAGE", score: 92 },
  { src: "/hero/clip-3.mp4", poster: "/hero/clip-3.jpg", label: "FUNNY", score: 78 },
];

/** The band under the hero buttons: a long stream on the left, glowing dots, and the clips Klyp made on the right. */
export default function BeforeAfterBand() {
  return (
    <section aria-label="From a long stream to short clips" className="relative px-6 pb-16 pt-2 sm:pb-20">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-center gap-8 lg:flex-row lg:gap-10">
        <VodBeforeCard />
        <LoadingDots />
        <ClipStack clips={HERO_CLIPS} />
      </div>
    </section>
  );
}
