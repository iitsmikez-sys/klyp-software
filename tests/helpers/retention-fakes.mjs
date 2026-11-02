const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2);

/** The tables and the two SQL functions of migration 040, in memory (the SQL itself is tested in retention-sql.test.mjs). */
export function makeAdmin(opts = {}) {
  const t = { cancellation_events: [], retention_offers: [] };
  let n = 0;
  const now = () => opts.now ?? NOW;
  const iso = (ms) => new Date(ms).toISOString();
  const from = (table) => {
    const f = { eq: [], in: null, op: "select", changes: null, single: false };
    const match = (r) => f.eq.every(([c, v]) => r[c] === v) && (!f.in || f.in[1].includes(r[f.in[0]]));
    const q = {
      select() { return q; },
      eq(c, v) { f.eq.push([c, v]); return q; },
      in(c, vals) { f.in = [c, vals]; return q; },
      insert(row) {
        const rec = { id: `row-${++n}`, decision: "none", ...row };
        if (opts.failSurveyInsert) { f.op = "failed"; return q; }
        t[table].push(rec); f.op = "insert"; f.rec = rec; return q;
      },
      update(changes) { f.op = "update"; f.changes = changes; return q; },
      single() { f.single = true; return q; },
      maybeSingle() { f.single = "maybe"; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (f.op === "failed") return { data: null, error: { message: "insert failed" } };
          if (f.op === "insert") return { data: f.single ? { id: f.rec.id } : null, error: null };
          if (f.op === "update") { t[table].filter(match).forEach((r) => Object.assign(r, f.changes)); return { data: null, error: null }; }
          const rows = t[table].filter(match);
          return { data: f.single ? rows[0] ?? null : rows, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  };
  const rpc = async (fn, a) => {
    if (fn === "claim_retention_offer") {
      const offers = t.retention_offers;
      if (a.p_offer === "discount_40") {
        const last = Math.max(0, ...offers.filter((o) => o.user_id === a.p_user_id && o.offer === "discount_40" && o.status !== "failed")
          .map((o) => new Date(o.confirmed_at ?? o.created_at).getTime()));
        if (last && last + 180 * DAY > now()) return { error: { message: `discount_not_eligible:${iso(last + 180 * DAY).slice(0, 10)}` } };
      }
      if (offers.some((o) => o.user_id === a.p_user_id && o.offer === a.p_offer && o.status === "pending")) return { error: { code: "23505", message: "dup" } };
      const rec = { id: `offer-${++n}`, user_id: a.p_user_id, event_id: a.p_event_id, stripe_subscription_id: a.p_subscription_id, offer: a.p_offer, status: "pending", created_at: iso(now()) };
      offers.push(rec);
      return { data: rec.id, error: null };
    }
    if (fn === "finish_retention_offer") {
      const o = t.retention_offers.find((x) => x.id === a.p_offer_id && x.status === "pending");
      if (o) { o.status = a.p_status; if (a.p_status === "confirmed") o.confirmed_at = iso(now()); }
      return { error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  };
  return { from, rpc, t };
}

