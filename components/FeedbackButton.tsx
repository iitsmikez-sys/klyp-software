"use client";

/**
 * The "Something wrong?" button on every dashboard page: a black circle that grows into a pill on hover, and a plain
 * white form (pick a reason, add a few words, send). The message is saved to feedback_messages (migration 049) and a
 * background job emails it to the owner with the person's plan, Sparks, last video and browser attached. Anywhere in the
 * app can open the form with openFeedback(), for example "Tell us what happened" after a failed download.
 */
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FEEDBACK_REASONS, MAX_FEEDBACK_MESSAGE, isFeedbackReason, type FeedbackReason } from "@/lib/feedback";
import styles from "./FeedbackButton.module.css";

export const FEEDBACK_EVENT = "klyp:feedback";

/** Open the form, optionally with a reason and some text already filled in. */
export function openFeedback(detail: { reason?: FeedbackReason; message?: string } = {}) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail }));
}

type Status = "idle" | "sending" | "sent" | "error";

export default function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const groupName = useId();

  // Anything in the app can open the form (for example after a failed download).
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string; message?: string }>).detail ?? {};
      if (isFeedbackReason(detail.reason)) setReason(detail.reason);
      if (typeof detail.message === "string") setMessage(detail.message.slice(0, MAX_FEEDBACK_MESSAGE));
      setStatus("idle");
      setOpen(true);
    };
    window.addEventListener(FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_EVENT, onOpen);
  }, []);

  // Escape closes it and puts focus back on the button; opening moves focus into the form.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => { setOpen(false); buttonRef.current?.focus(); };

  const send = async () => {
    if (!reason || status === "sending") return;
    setStatus("sending");
    setErrorText("");
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) throw new Error("Please sign in again, then try once more.");
      const { error } = await supabase.from("feedback_messages").insert({
        user_id: userId, reason, message: message.trim(), page: pathname?.slice(0, 200) ?? null,
        user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 300),
      });
      if (error) throw new Error(/too many/i.test(error.message) ? "That's a lot of messages in a short time. Please try again later." : "Couldn't send that. Please try again in a moment.");
      setStatus("sent");
      setReason(null);
      setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorText(err instanceof Error ? err.message : "Couldn't send that. Please try again in a moment.");
    }
  };

  return (
    <>
      {open && (
        <div ref={panelRef} role="dialog" aria-modal="false" aria-label="Tell us what went wrong" className={styles.panel}>
          {status === "sent" ? (
            <div className={styles.done} role="status">
              <div className={styles.tick} aria-hidden="true">&#10003;</div>
              <p className={styles.doneTitle}>Thanks, we got it</p>
              <p className={styles.doneText}>We read every message and reply by email.</p>
              <button type="button" className={styles.secondary} onClick={close}>Close</button>
            </div>
          ) : (
            <>
              <div className={styles.top}>
                <h2 className={styles.title}>What went wrong?</h2>
                <button type="button" className={styles.close} onClick={close} aria-label="Close">&#10005;</button>
              </div>
              <p className={styles.sub}>Pick one, then tell us more if you like.</p>
              <fieldset className={styles.fieldset}>
                <legend className="sr-only">Reason</legend>
                {FEEDBACK_REASONS.map((item) => (
                  <label key={item.key} className={`${styles.option} ${reason === item.key ? styles.on : ""}`}>
                    <input type="radio" name={groupName} className={styles.radio} checked={reason === item.key} onChange={() => setReason(item.key)} />
                    {item.label}
                  </label>
                ))}
              </fieldset>
              <textarea
                className={styles.text}
                aria-label="Tell us more (optional)"
                placeholder="Tell us more (optional)"
                value={message}
                maxLength={MAX_FEEDBACK_MESSAGE}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p className={styles.note}>We'll include your last video and plan so you don't have to explain.</p>
              {status === "error" && <p className={styles.error} role="alert">{errorText}</p>}
              <button type="button" className={styles.send} disabled={!reason || status === "sending"} onClick={() => void send()}>
                {status === "sending" ? "Sending…" : "Send"}
              </button>
            </>
          )}
        </div>
      )}
      <button
        ref={buttonRef}
        type="button"
        className={styles.fab}
        aria-label="Something wrong? Send us a message"
        aria-expanded={open}
        onClick={() => (open ? close() : (setStatus("idle"), setOpen(true)))}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 14v-2a9 9 0 0 1 18 0v2" />
          <path d="M21 15a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2z" />
          <path d="M3 15a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z" />
        </svg>
        <span className={styles.label}>Something wrong?</span>
      </button>
    </>
  );
}
