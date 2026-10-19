/**
 * The landing page's "one VOD becomes several shorts" demo reel.
 *
 * Klyp ships no demo footage, and the clips in the app belong to individual
 * users, so none of it can be put on a public marketing page. This manifest
 * names the files the demo needs; drop them into public/demo and the section
 * switches from its diagram to real players automatically (app/page.tsx checks
 * for them on the server at render time).
 *
 * Nothing here invents metadata: durations are read from the files themselves
 * at runtime, so a swapped clip can never be mislabelled.
 */

export type DemoClip = {
  /** Vertical export, as Klyp would produce it. */
  src: string;
  /** Still frame, shown before anything is played — no autoplay needed. */
  poster: string;
  /** Short, factual label for assistive tech. Not marketing copy. */
  label: string;
};

/** The landscape source VOD the three clips are cut from. */
export const DEMO_SOURCE = {
  src: "/demo/source.mp4",
  poster: "/demo/source.jpg",
  label: "Example stream VOD",
};

/** The vertical clips cut from DEMO_SOURCE, in the order they're shown. */
export const DEMO_CLIPS: DemoClip[] = [
  { src: "/demo/clip-1.mp4", poster: "/demo/clip-1.jpg", label: "Example clip one" },
  { src: "/demo/clip-2.mp4", poster: "/demo/clip-2.jpg", label: "Example clip two" },
  { src: "/demo/clip-3.mp4", poster: "/demo/clip-3.jpg", label: "Example clip three" },
];

/** Every file the demo needs, relative to public/ — used by the server check. */
export const DEMO_ASSET_PATHS = [
  DEMO_SOURCE.src,
  DEMO_SOURCE.poster,
  ...DEMO_CLIPS.flatMap((c) => [c.src, c.poster]),
];
