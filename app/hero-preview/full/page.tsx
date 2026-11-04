import type { Metadata } from "next";
import LandingPage from "@/components/landing/LandingPage";

/** A private full-page preview: your real landing page with the new before and after band under the hero. */
export const metadata: Metadata = {
  title: "Landing page preview",
  robots: { index: false, follow: false },
};

export default function FullLandingPreviewPage() {
  return <LandingPage beforeAfter />;
}
