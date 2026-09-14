"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import NotificationBell from "./NotificationBell";
import { navItems } from "./Sidebar";

/**
 * Mobile replacement for Sidebar (<768px): a sticky top bar (logo + bell)
 * and a fixed bottom tab bar covering the same nav items. Sidebar itself
 * stays `hidden md:flex` — this is the only nav rendered under the md
 * breakpoint, so it must carry every route Sidebar links to.
 */
export default function MobileNav() {
  const pathname = usePathname();

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-surface border-b border-border">
        <Logo size="sm" />
        <NotificationBell />
      </header>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex bg-surface border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? "text-accent" : "text-foreground-muted"
              }`}
            >
              {item.icon}
              <span className="truncate max-w-full px-0.5">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
