import LandingPage from "@/components/landing/LandingPage";
import { TRIAL_DAYS, TRIAL_PRICE_CENTS, trialMode } from "@/lib/pro-trial";

export default function Home() {
  return <LandingPage beforeAfter firstMonthForAll={(process.env.FIRST_MONTH_OFFER ?? "").trim().toLowerCase() === "all"} trial={trialMode() === "on" ? { days: TRIAL_DAYS, priceCents: TRIAL_PRICE_CENTS } : undefined} />;
}
