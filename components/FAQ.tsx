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
    a: "You can analyze published YouTube videos and Twitch VODs. Automatic clipping after a stream is coming soon.",
  },
  {
    q: "Do I need to leave my computer on?",
    a: "The VOD analysis runs on Klyp's processing service. Keep the dashboard open until it returns your results.",
  },
  {
    q: "What video quality are the exported clips?",
    a: "Clips are exported at the source quality of your stream — up to 1080p60 on Pro and Agency plans. Free plan clips are capped at 720p30.",
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
