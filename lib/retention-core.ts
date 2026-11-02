/**
 * Cancellation retention for Klyp Pro: the survey, a one-payment 40% discount, a 1 or 2 month pause,
 * and the cancellation itself.
 *
 * Rules this module keeps (each one has a test in tests/retention-core.test.mjs):
 *  - Nothing is applied silently: every change is an explicit action by the signed-in subscriber.
 *  - Nothing is reported as done until Stripe shows it. After each Stripe write the subscription is
 *    read back and checked; if it does not show the change, the answer is "failed" and the offer
 *    does not count against the person.
 *  - The discount limit (once per 180 days) is enforced in the database by claim_retention_offer
 *    (migration 040), not by the UI.
 *  - Only existing subscriptions are updated; this module never creates one.
 *  - Cancelling is always possible and needs no offer.
 * Stripe and the database are injected so tests never touch a real account.
 */

export const RETENTION = {
  DISCOUNT_PERCENT: 40,
  PRICE_CENTS: 2800,
  COUPON_ID: "klyp-save-40-once",
  DISCOUNT_COOLDOWN_DAYS: 180,
} as const;

export const DISCOUNTED_CENTS = Math.round(RETENTION.PRICE_CENTS * (100 - RETENTION.DISCOUNT_PERCENT) / 100);

export const REASONS = ["not_good_clips", "break", "too_expensive", "not_using", "other"] as const;
export type Reason = (typeof REASONS)[number];
export const SUB_REASONS = ["not_entertaining", "missing_moments", "cut_off", "other"] as const;
export type SubReason = (typeof SUB_REASONS)[number];

/** Which offers are shown for each answer. Only "too_expensive" ever shows the discount. */
export const OFFERS_BY_REASON: Record<Reason, readonly string[]> = {
  not_good_clips: ["help", "feedback"],
  break: ["pause"],
  too_expensive: ["discount"],
  not_using: ["tips", "pause"],
  other: ["feedback"],
};

type IdOrObject = string | { id: string } | null | undefined;

export type RetSubscription = {
  id: string;
  status: string;
  customer?: IdOrObject;
  cancel_at_period_end: boolean;
  pause_collection: { behavior: string; resumes_at?: number | null } | null;
  discounts?: Array<string | { source?: { coupon?: IdOrObject } | null; coupon?: IdOrObject }>;
  items: { data: Array<{ current_period_end: number }> };
};

export type RetentionStripe = {
  subscriptions: {
    retrieve(id: string, params?: Record<string, unknown>): Promise<RetSubscription>;
    update(id: string, params: Record<string, unknown>, options?: Record<string, unknown>): Promise<RetSubscription>;
  };
  coupons: {
    retrieve(id: string): Promise<{ id: string }>;
    create(params: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ id: string }>;
  };
};

type DbError = { code?: string; message: string } | null;
export type RetentionAdmin = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data?: unknown; error: DbError }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

export type RetentionCtx = { userId: string; subscriptionId: string };
export type RetentionResult = { status: number; body: Record<string, unknown> };

const idOf = (v: IdOrObject): string | undefined => (!v ? undefined : typeof v === "string" ? v : v.id);
const isMissing = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "resource_missing";
const iso = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const FAIL_STRIPE = "We couldn't reach Stripe to make that change. Nothing was changed and you have not been charged. Please try again.";

export function periodEnd(sub: RetSubscription): number {
  return sub.items.data[0].current_period_end;
}

/** Add whole months in UTC, clamping to month end (Jan 31 + 1 month = Feb 28), like Stripe's own billing dates. */
export function addMonthsUtc(seconds: number, months: number): number {
  const d = new Date(seconds * 1000);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return Math.floor(d.getTime() / 1000);
}

export function hasKlypDiscount(sub: RetSubscription): boolean {
  return (sub.discounts ?? []).some((d) => typeof d === "object" && d && idOf(d.source?.coupon ?? d.coupon) === RETENTION.COUPON_ID);
}
const hasAnyDiscount = (sub: RetSubscription) => (sub.discounts ?? []).length > 0;
const isLive = (sub: RetSubscription) => sub.status === "active" || sub.status === "trialing";
const isPaused = (sub: RetSubscription) => !!sub.pause_collection;

async function readSub(stripe: RetentionStripe, id: string): Promise<RetSubscription> {
  return stripe.subscriptions.retrieve(id, { expand: ["discounts"] });
}

/** When the discount becomes available again (null when it is available now). */
async function discountAvailableOn(admin: RetentionAdmin, userId: string, now: number): Promise<string | null> {
  const { data, error } = await admin.from("retention_offers").select("status, created_at, confirmed_at")
    .eq("user_id", userId).eq("offer", "discount_40").in("status", ["pending", "confirmed"]);
  if (error) throw new Error(`Could not check discount eligibility: ${error.message}`);
  let last = 0;
  for (const row of (data ?? []) as { confirmed_at: string | null; created_at: string }[]) {
    last = Math.max(last, new Date(row.confirmed_at ?? row.created_at).getTime());
  }
  const until = last + RETENTION.DISCOUNT_COOLDOWN_DAYS * 86_400_000;
  return last && until > now ? new Date(until).toISOString() : null;
}

/** Settle claims left "pending" (an answer from Stripe was lost): confirm if Stripe shows it, fail if it never did. */
async function settlePending(deps: Deps, ctx: RetentionCtx, sub: RetSubscription): Promise<void> {
  const { data } = await deps.admin.from("retention_offers").select("id, offer, created_at")
    .eq("user_id", ctx.userId).eq("status", "pending");
  for (const row of (data ?? []) as { id: string; offer: string; created_at: string }[]) {
    const applied = row.offer === "discount_40" ? hasKlypDiscount(sub) : isPaused(sub);
    const stale = (deps.now ?? Date.now()) - new Date(row.created_at).getTime() > 10 * 60_000;
    if (applied) await deps.admin.rpc("finish_retention_offer", { p_offer_id: row.id, p_status: "confirmed", p_ref: ctx.subscriptionId });
    else if (stale) await deps.admin.rpc("finish_retention_offer", { p_offer_id: row.id, p_status: "failed", p_ref: null });
  }
}

export type Deps = { stripe: RetentionStripe; admin: RetentionAdmin; now?: number };

export async function getRetentionState(deps: Deps, ctx: RetentionCtx): Promise<RetentionResult> {
  let sub: RetSubscription;
  try { sub = await readSub(deps.stripe, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  await settlePending(deps, ctx, sub);
  const availableOn = await discountAvailableOn(deps.admin, ctx.userId, deps.now ?? Date.now());
  const discounted = hasKlypDiscount(sub);
  return {
    status: 200,
    body: {
      subscriptionStatus: sub.status,
      periodEnd: iso(periodEnd(sub)),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      pausedUntil: iso(sub.pause_collection?.resumes_at),
      paused: isPaused(sub),
      discountApplied: discounted,
      discountEligible: isLive(sub) && !availableOn && !hasAnyDiscount(sub) && !isPaused(sub) && !sub.cancel_at_period_end,
      discountAvailableOn: availableOn,
      priceCents: RETENTION.PRICE_CENTS,
      discountedCents: DISCOUNTED_CENTS,
      nextAmountCents: discounted ? DISCOUNTED_CENTS : RETENTION.PRICE_CENTS,
    },
  };
}

/** Record the survey answer. Returns the survey id and the offers to show for it. */
export async function recordSurvey(deps: Deps, ctx: RetentionCtx, input: { reason?: unknown; subReason?: unknown; detail?: unknown }): Promise<RetentionResult> {
  const reason = input.reason as Reason;
  if (!REASONS.includes(reason)) return { status: 400, body: { error: "Choose a reason." } };
  const subReason = input.subReason == null || input.subReason === "" ? null : (input.subReason as SubReason);
  if (subReason !== null && (reason !== "not_good_clips" || !SUB_REASONS.includes(subReason)))
    return { status: 400, body: { error: "Invalid follow-up answer." } };
  const detail = typeof input.detail === "string" && input.detail.trim() ? input.detail.trim().slice(0, 1000) : null;
  const { data, error } = await deps.admin.from("cancellation_events")
    .insert({ user_id: ctx.userId, stripe_subscription_id: ctx.subscriptionId, reason, sub_reason: subReason, detail })
    .select("id").single();
  if (error || !data) return { status: 500, body: { error: "Could not save your answer. You can still continue." } };
  return { status: 200, body: { eventId: (data as { id: string }).id, offers: OFFERS_BY_REASON[reason] } };
}

async function loadEvent(deps: Deps, ctx: RetentionCtx, eventId: unknown): Promise<{ id: string; reason: Reason } | null> {
  if (typeof eventId !== "string") return null;
  const { data } = await deps.admin.from("cancellation_events").select("id, reason")
    .eq("id", eventId).eq("user_id", ctx.userId).maybeSingle();
  return (data as { id: string; reason: Reason } | null) ?? null;
}

async function setDecision(deps: Deps, eventId: string | null, decision: string) {
  if (eventId) await deps.admin.from("cancellation_events").update({ decision, updated_at: new Date().toISOString() }).eq("id", eventId);
}

async function claim(deps: Deps, ctx: RetentionCtx, eventId: string, offer: string): Promise<{ id: string } | RetentionResult> {
  const { data, error } = await deps.admin.rpc("claim_retention_offer", {
    p_user_id: ctx.userId, p_event_id: eventId, p_subscription_id: ctx.subscriptionId, p_offer: offer,
  });
  if (error) {
    const m = /discount_not_eligible:(\d{4}-\d{2}-\d{2})/.exec(error.message);
    if (m) return { status: 409, body: { code: "discount_not_eligible", availableOn: m[1], error: `This offer is available once every 6 months. You can use it again on ${m[1]}.` } };
    if (error.code === "23505") return { status: 409, body: { code: "in_progress", error: "This is already being applied. Please wait a moment." } };
    return { status: 500, body: { error: "Could not start that. Nothing was changed." } };
  }
  return { id: data as string };
}

const finish = (deps: Deps, id: string, status: "confirmed" | "failed", ref: string | null) =>
  deps.admin.rpc("finish_retention_offer", { p_offer_id: id, p_status: status, p_ref: ref });

/** One fixed coupon: 40% off, once. Created on first use, reused after. */
async function ensureCoupon(stripe: RetentionStripe): Promise<void> {
  try {
    await stripe.coupons.retrieve(RETENTION.COUPON_ID);
  } catch (err) {
    if (!isMissing(err)) throw err;
    await stripe.coupons.create({
      id: RETENTION.COUPON_ID, percent_off: RETENTION.DISCOUNT_PERCENT, duration: "once", name: "Klyp: 40% off one payment",
    });
  }
}

export async function applyDiscount(deps: Deps, ctx: RetentionCtx, input: { eventId?: unknown }): Promise<RetentionResult> {
  const event = await loadEvent(deps, ctx, input.eventId);
  if (!event) return { status: 400, body: { error: "Start from the cancellation survey." } };
  // The discount is only for people who said it is too expensive. Other answers never get it.
  if (event.reason !== "too_expensive") return { status: 403, body: { error: "This offer isn't available for that answer." } };

  let sub: RetSubscription;
  try { sub = await readSub(deps.stripe, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  if (!isLive(sub) || sub.cancel_at_period_end || isPaused(sub))
    return { status: 409, body: { code: "not_applicable", error: "The discount can't be applied to this subscription right now." } };
  if (hasAnyDiscount(sub)) return { status: 409, body: { code: "already_discounted", error: "This subscription already has a discount." } };

  const claimed = await claim(deps, ctx, event.id, "discount_40");
  if (!("id" in claimed)) return claimed;

  try {
    await ensureCoupon(deps.stripe);
    await deps.stripe.subscriptions.update(ctx.subscriptionId, { discounts: [{ coupon: RETENTION.COUPON_ID }] },
      { idempotencyKey: `klyp-discount-${claimed.id}` });
    const after = await readSub(deps.stripe, ctx.subscriptionId);
    if (!hasKlypDiscount(after)) throw new Error("discount not visible on the subscription");
  } catch {
    await finish(deps, claimed.id, "failed", null);
    return { status: 502, body: { status: "failed", error: "We couldn't apply the discount. Nothing was changed and you have not been charged." } };
  }
  await finish(deps, claimed.id, "confirmed", ctx.subscriptionId);
  await setDecision(deps, event.id, "accepted_offer");
  return {
    status: 200,
    body: { status: "confirmed", nextAmountCents: DISCOUNTED_CENTS, thenAmountCents: RETENTION.PRICE_CENTS, nextBillingDate: iso(periodEnd(sub)) },
  };
}

export async function applyPause(deps: Deps, ctx: RetentionCtx, input: { eventId?: unknown; months?: unknown }): Promise<RetentionResult> {
  const months = Number(input.months);
  if (months !== 1 && months !== 2) return { status: 400, body: { error: "Choose a 1 or 2 month pause." } };
  const event = await loadEvent(deps, ctx, input.eventId);
  if (!event) return { status: 400, body: { error: "Start from the cancellation survey." } };
  if (event.reason !== "break" && event.reason !== "not_using")
    return { status: 403, body: { error: "This offer isn't available for that answer." } };

  let sub: RetSubscription;
  try { sub = await readSub(deps.stripe, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  if (!isLive(sub)) return { status: 409, body: { code: "not_applicable", error: "This subscription can't be paused right now." } };
  if (sub.cancel_at_period_end)
    return { status: 409, body: { code: "cancellation_pending", error: "Your cancellation is already scheduled. Undo it first if you'd rather pause." } };
  if (isPaused(sub)) return { status: 409, body: { code: "already_paused", error: "This subscription is already paused." } };

  const end = periodEnd(sub);
  const resumesAt = addMonthsUtc(end, months);
  const claimed = await claim(deps, ctx, event.id, months === 1 ? "pause_1" : "pause_2");
  if (!("id" in claimed)) return claimed;

  try {
    await deps.stripe.subscriptions.update(ctx.subscriptionId, { pause_collection: { behavior: "void", resumes_at: resumesAt } },
      { idempotencyKey: `klyp-pause-${claimed.id}` });
    const after = await readSub(deps.stripe, ctx.subscriptionId);
    if (after.pause_collection?.behavior !== "void" || after.pause_collection.resumes_at !== resumesAt)
      throw new Error("pause not visible on the subscription");
  } catch {
    await finish(deps, claimed.id, "failed", null);
    return { status: 502, body: { status: "failed", error: "We couldn't pause your subscription. Nothing was changed and you have not been charged." } };
  }
  await finish(deps, claimed.id, "confirmed", ctx.subscriptionId);
  await setDecision(deps, event.id, "accepted_offer");
  return {
    status: 200,
    body: { status: "confirmed", proUntil: iso(end), resumesOn: iso(resumesAt), nextAmountCents: RETENTION.PRICE_CENTS },
  };
}

const STRIPE_FEEDBACK: Record<Reason, string> = {
  not_good_clips: "low_quality", break: "other", too_expensive: "too_expensive", not_using: "unused", other: "other",
};

export async function cancelSubscription(deps: Deps, ctx: RetentionCtx, input: { eventId?: unknown }): Promise<RetentionResult> {
  const event = input.eventId ? await loadEvent(deps, ctx, input.eventId) : null;
  let sub: RetSubscription;
  try { sub = await readSub(deps.stripe, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  if (sub.cancel_at_period_end) {
    return { status: 200, body: { status: "confirmed", accessUntil: iso(periodEnd(sub)), already: true } };
  }
  if (!isLive(sub)) return { status: 409, body: { code: "not_applicable", error: "This subscription is no longer active." } };
  try {
    await deps.stripe.subscriptions.update(ctx.subscriptionId, {
      cancel_at_period_end: true,
      ...(event ? { cancellation_details: { feedback: STRIPE_FEEDBACK[event.reason] } } : {}),
    });
    // No idempotency key here on purpose: this is a plain on/off switch, so repeating it is harmless, and a
    // reused key (cancel, undo, cancel again) would make Stripe replay the first answer instead of acting.
    const after = await readSub(deps.stripe, ctx.subscriptionId);
    if (!after.cancel_at_period_end) throw new Error("cancellation not visible on the subscription");
  } catch {
    return { status: 502, body: { status: "failed", error: "We couldn't confirm your cancellation with Stripe, so it has not been made. Please try again, or use Manage billing." } };
  }
  await setDecision(deps, event?.id ?? null, "cancelled");
  return { status: 200, body: { status: "confirmed", accessUntil: iso(periodEnd(sub)) } };
}

export async function undoCancellation(deps: Deps, ctx: RetentionCtx): Promise<RetentionResult> {
  let sub: RetSubscription;
  try { sub = await readSub(deps.stripe, ctx.subscriptionId); } catch { return { status: 502, body: { error: FAIL_STRIPE } }; }
  if (!sub.cancel_at_period_end) return { status: 200, body: { status: "confirmed", already: true } };
  if (!isLive(sub)) return { status: 409, body: { code: "not_applicable", error: "This subscription is no longer active." } };
  try {
    await deps.stripe.subscriptions.update(ctx.subscriptionId, { cancel_at_period_end: false });
    const after = await readSub(deps.stripe, ctx.subscriptionId);
    if (after.cancel_at_period_end) throw new Error("still scheduled");
  } catch {
    return { status: 502, body: { status: "failed", error: "We couldn't undo the cancellation. It is still scheduled." } };
  }
  return { status: 200, body: { status: "confirmed" } };
}

export async function runRetentionAction(deps: Deps, ctx: RetentionCtx, action: string, body: Record<string, unknown>): Promise<RetentionResult> {
  switch (action) {
    case "state": return getRetentionState(deps, ctx);
    case "survey": return recordSurvey(deps, ctx, body);
    case "discount": return applyDiscount(deps, ctx, body);
    case "pause": return applyPause(deps, ctx, body);
    case "cancel": return cancelSubscription(deps, ctx, body);
    case "undo-cancel": return undoCancellation(deps, ctx);
    default: return { status: 404, body: { error: "Unknown action." } };
  }
}
