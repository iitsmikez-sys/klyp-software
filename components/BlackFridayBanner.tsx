"use client";

import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/track";
import { BLACK_FRIDAY_ENDS_TEXT, BLACK_FRIDAY_LINK, BLACK_FRIDAY_PRICE_DOLLARS, blackFridayActive, showBlackFridayBanner } from "@/lib/black-friday";

const GOLD_BG = "linear-gradient(90deg, #120f05 0%, #1d1707 50%, #120f05 100%)";
const GOLD_GLOW = "radial-gradient(circle at 50% -40%, rgba(255,196,60,0.28), transparent 60%)";

function Tag() {
  return <span className="relative rounded-md bg-[#ffc43c] px-2 py-1 text-[11px] font-black tracking-[0.12em] text-[#1a1300]">BLACK FRIDAY</span>;
}

/**
 * The Black Friday banner (lib/black-friday.ts). `strip` is the thin bar at the top of the landing page; `card` is the box at the top of
 * the dashboard for an account that can use the deal. Both open the same $14 link, and both go away by themselves after the end date.
 */
export default function BlackFridayBanner({ variant }: { variant: "strip" | "card" }) {
  const [active, setActive] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [newCustomer, setNewCustomer] = useState(false);

  useEffect(() => {
    setActive(blackFridayActive());
    let cancelled = false;
    fetch("/api/stripe/checkout").then((r) => r.json()).then((data) => {
      if (cancelled) return;
      setSignedIn(data?.signed_in === true);
      setNewCustomer(data?.new_customer === true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const show = showBlackFridayBanner({ variant, active, signedIn, newCustomer });
  useEffect(() => { if (show && signedIn) void trackEvent("black_friday_view", { variant }); }, [show, signedIn, variant]);
  if (!show) return null;
  const click = () => { if (signedIn) void trackEvent("black_friday_click", { variant }); };

  if (variant === "strip") {
    return (
      <div data-black-friday="strip" className="relative flex flex-col items-center justify-center gap-x-4 gap-y-1.5 overflow-hidden border-b border-[#4a3a10] px-4 py-2.5 text-center sm:flex-row" style={{ background: GOLD_BG }}>
        <div className="pointer-events-none absolute inset-0" style={{ background: GOLD_GLOW }} />
        <Tag />
        <span className="relative text-sm text-[#f4efe0]">First month of Klyp Pro <s className="mr-1 text-[#8c8570]">$28</s><b className="text-[#ffd978]">${BLACK_FRIDAY_PRICE_DOLLARS}</b> <span className="mx-1">·</span> half off</span>
        <a href={BLACK_FRIDAY_LINK} onClick={click} className="relative whitespace-nowrap rounded-[9px] bg-accent px-3.5 py-1.5 text-[13px] font-extrabold text-[#06382a] hover:bg-accent-dim">Get ${BLACK_FRIDAY_PRICE_DOLLARS} →</a>
        <span className="relative text-xs text-[#b9ae8a]">{BLACK_FRIDAY_ENDS_TEXT}</span>
      </div>
    );
  }

  return (
    <section data-black-friday="card" aria-label="Black Friday offer" className="relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-[#4a3a10] p-4 sm:flex-row sm:items-center sm:p-5" style={{ background: "linear-gradient(100deg, #150f03, #231a06 60%, #150f03)" }}>
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full" style={{ background: "radial-gradient(circle, rgba(255,196,60,0.32), transparent 65%)" }} />
      <div className="relative flex-1">
        <Tag />
        <p className="mt-2 font-syne text-[19px] font-extrabold leading-tight text-foreground">
          First month of Pro: <span className="text-[#ffd978]">${BLACK_FRIDAY_PRICE_DOLLARS}</span> <span className="text-sm font-medium text-[#b9ae8a]">(half off)</span>
        </p>
        <p className="mt-1 text-[12.5px] leading-snug text-[#b9ae8a]">500 Sparks, no watermark, every clip unlocked. Then $28 a month, cancel any time. {BLACK_FRIDAY_ENDS_TEXT}.</p>
      </div>
      <a href={BLACK_FRIDAY_LINK} onClick={click} className="relative flex min-h-11 items-center justify-center whitespace-nowrap rounded-[11px] bg-accent px-5 text-sm font-extrabold text-[#06382a] hover:bg-accent-dim">Get Pro for ${BLACK_FRIDAY_PRICE_DOLLARS}</a>
    </section>
  );
}
