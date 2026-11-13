import LandingPage from "@/components/landing/LandingPage";
import { TRIAL_DAYS, trialMode } from "@/lib/pro-trial";

export default function Home() {
  return <LandingPage beforeAfter firstMonthForAll={(process.env.FIRST_MONTH_OFFER ?? "").trim().toLowerCase() === "all"} trialDays={trialMode() === "on" ? TRIAL_DAYS : 0} />;
}
