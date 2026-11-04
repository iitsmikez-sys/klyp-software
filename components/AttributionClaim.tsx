"use client";

import { useEffect } from "react";

const DONE_KEY = "klyp_src_claimed";

/** Quietly saves where this account came from, once per tab session. It renders nothing and never shows an error. */
export default function AttributionClaim() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(DONE_KEY)) return;
    } catch {
      return;
    }
    fetch("/api/attribution", { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          try { sessionStorage.setItem(DONE_KEY, "1"); } catch { /* storage unavailable */ }
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
