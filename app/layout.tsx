import { NavigationGuardProvider } from "@/components/NavigationGuardProvider";
import type { Metadata } from "next";
import { Syne, DM_Sans } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

/** Geist — modal/dialog typography. The variable file already shipped in app/fonts. */
const geist = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Klyp — AI Video Clips for Streamers",
  description:
    "Paste a YouTube or Twitch VOD link to find, review, save, and export clips with Klyp.",
  keywords: ["streaming", "clips", "AI", "Twitch", "YouTube", "content creation"],
  verification: { google: "dWdc8Wy30rS6xoA9lavXIfFNSlqerWilbgldW_dfX-Q" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} ${geist.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased">
        <NavigationGuardProvider>{children}</NavigationGuardProvider>
      </body>
    </html>
  );
}
