import LandingPage from "@/components/landing/LandingPage";

export default function Home() {
  return <LandingPage beforeAfter firstMonthForAll={(process.env.FIRST_MONTH_OFFER ?? "").trim().toLowerCase() === "all"} />;
}
