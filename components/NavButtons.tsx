"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function NavButtons() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setLoggedIn(!!data.user));
  }, []);

  // Don't flash wrong buttons while checking
  if (loggedIn === null) return <div className="w-36 h-8" />;

  if (loggedIn) {
    return (
      <Link
        href="/dashboard"
        className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm"
      >
        Open Dashboard →
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link
        href="/login"
        className="text-sm text-foreground-muted hover:text-foreground transition-colors"
      >
        Sign in
      </Link>
      <Link
        href="/login"
        className="px-4 py-2 rounded-lg bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors shadow-accent-glow-sm"
      >
        Get started free
      </Link>
    </div>
  );
}
