"use client";

import { useState, FormEvent } from "react";
import FadeIn from "./FadeIn";

export default function Waitlist() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || status === "sending") return;
    setStatus("sending");

    // TODO: hook up EmailJS — npm i @emailjs/browser, then:
    //   import emailjs from "@emailjs/browser";
    //   await emailjs.send("SERVICE_ID", "TEMPLATE_ID", { email }, { publicKey: "PUBLIC_KEY" });
    await new Promise((r) => setTimeout(r, 700));

    setStatus("done");
  };

  return (
    <section id="waitlist" className="relative px-6 py-24 overflow-hidden bg-surface border-y border-border">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[480px] h-[300px] rounded-full bg-accent opacity-[0.05] blur-[100px]" />
      </div>

      <FadeIn className="relative z-10 max-w-xl mx-auto text-center">
        <p className="text-accent text-xs font-semibold font-syne uppercase tracking-widest mb-3">
          Early access
        </p>
        <h2 className="font-syne text-3xl md:text-4xl font-bold text-foreground mb-4">
          Join the waitlist
        </h2>
        <p className="text-foreground-muted text-sm mb-8">
          Be first in line when new AI clipping features drop. No spam, ever.
        </p>

        {status === "done" ? (
          <div className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-accent-glow border border-accent/30 text-accent text-sm font-medium">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            You&apos;re on the list — see you soon!
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="flex-1 px-4 py-3 rounded-xl bg-surface-2 border border-border text-sm text-foreground placeholder:text-subtle focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="pulse-glow px-6 py-3 rounded-xl bg-accent text-background text-sm font-bold font-syne hover:bg-accent-dim transition-colors disabled:opacity-60"
            >
              {status === "sending" ? "Joining…" : "Join waitlist"}
            </button>
          </form>
        )}
      </FadeIn>
    </section>
  );
}
