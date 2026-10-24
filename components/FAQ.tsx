"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const faqs = [
  {
    q: "How does Klyp know what to clip?",
    a: "Paste a YouTube or Twitch VOD link. Klyp transcribes its audio and suggests moments to review and save.",
  },
  {
    q: "Which streaming platforms are supported?",
    a: "You can analyze published YouTube videos and Twitch VODs. Connect a Twitch channel to queue automatic clipping after a new VOD is published.",
  },
  {
    q: "Do I need to leave my computer on?",
    a: "No for connected Twitch channels: Klyp processes new published VODs on its service. For a manual analysis, keep the dashboard open until the results return.",
  },
  {
    q: "What video quality are the exported clips?",
    a: "Exports support 9:16 vertical and Original on Free, with 1:1 and 16:9 also available on Pro. Resolution depends on the source video and selected format.",
  },
  {
    q: "Does it work with pre-recorded VODs?",
    a: "Yes. Signed-in users can paste a YouTube or Twitch VOD link on the dashboard and review the suggested clips when analysis finishes.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Absolutely. No contracts, no lock-in. Cancel from your account settings and you keep access until the end of your billing period.",
  },
];

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {faqs.map((item, i) => (
        <div
          key={i}
          className={`rounded-xl border transition-colors ${
            open === i ? "border-accent/30 bg-surface" : "border-border bg-surface"
          }`}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-6 py-4 text-left gap-4"
          >
            <span className="text-sm font-medium text-foreground">{item.q}</span>
            <motion.span
              animate={{ rotate: open === i ? 45 : 0 }}
              transition={{ duration: 0.2 }}
              className="flex-shrink-0 text-accent text-lg leading-none"
            >
              +
            </motion.span>
          </button>

          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <p className="px-6 pb-5 text-sm text-foreground-muted leading-relaxed">
                  {item.a}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
