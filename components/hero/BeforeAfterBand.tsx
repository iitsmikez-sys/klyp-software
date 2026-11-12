import VodBeforeCard from "./VodBeforeCard";
import LoadingDots from "./LoadingDots";
import ClipStack, { type HeroClip } from "./ClipStack";

/** No scores are shown: the clips here are real, but the scores once shown (82, 92, 78) were not the ones Klyp gave. */
export const HERO_CLIPS: HeroClip[] = [
  { src: "/hero/clip-2.mp4", poster: "/hero/clip-2.jpg", label: "FUNNY" },
  { src: "/hero/clip-1.mp4", poster: "/hero/clip-1.jpg", label: "RAGE" },
  { src: "/hero/clip-3.mp4", poster: "/hero/clip-3.jpg", label: "FUNNY" },
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
