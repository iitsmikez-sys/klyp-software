/**
 * A tiny in-memory Supabase admin stand-in for the plan-enforcement tests. Rows live in plain
 * arrays/objects so a test can inspect exactly what a code path changed. Supports only the
 * calls those paths make; anything else throws, so a new untested call shows up as a failure.
 */
export function fakeAdmin({ profiles = {}, comp = {}, streams = [], jobs = [], checks = [], notifications = [], failOn = null } = {}) {
  const state = { profiles, streams, jobs, checks, notifications, authLookups: 0 };
  const tables = { profiles: Object.values(profiles), streams, auto_vod_jobs: jobs, pending_vod_checks: checks, notifications };
  const fail = (op) => (failOn === op ? { message: `${op} failed` } : null);
  const from = (table) => {
    if (!(table in tables)) throw new Error(`unexpected table ${table}`);
    const f = { eq: [], in: null, op: "select", changes: null, limit: null };
    const rows = () => tables[table];
    const match = (row) => f.eq.every(([c, v]) => row[c] === v) && (!f.in || f.in[1].includes(row[f.in[0]]));
    const q = {
      select() { return q; },
      eq(c, v) { f.eq.push([c, v]); return q; },
      in(c, vals) { f.in = [c, vals]; return q; },
      limit() { return q; },
      lt() { return q; },
      lte() { return q; },
      not() { return q; },
      update(changes) { f.op = "update"; f.changes = changes; return q; },
      delete() { f.op = "delete"; return q; },
      insert(row) {
        const err = fail(table);
        if (err) return Promise.resolve({ error: err });
        rows().push(row);
        return Promise.resolve({ error: null });
      },
      maybeSingle() {
        const err = fail(table === "profiles" ? "profile" : table);
        return Promise.resolve({ data: err ? null : rows().find(match) ?? null, error: err });
      },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const err = fail(table === "auto_vod_jobs" ? "jobs" : table === "pending_vod_checks" ? "checks" : table);
          if (err) return { data: null, error: err };
          if (f.op === "update") {
            const hit = rows().filter(match);
            hit.forEach((r) => Object.assign(r, f.changes));
            return { data: hit.map((r) => ({ id: r.id })), error: null };
          }
          if (f.op === "delete") {
            const arr = rows();
            for (let i = arr.length - 1; i >= 0; i--) if (match(arr[i])) arr.splice(i, 1);
            return { data: null, error: null };
          }
          return { data: rows().filter(match), error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  };
  const auth = { admin: { getUserById: async (id) => {
    state.authLookups++;
    if (failOn === "auth") return { data: null, error: { message: "auth failed" } };
    return { data: { user: { app_metadata: { klyp_complimentary_pro: comp[id] === true } } }, error: null };
  } } };
  return { from, auth, state };
}
export const notifier = () => { const sent = []; return { sent, notify: async (userId, message) => { sent.push({ userId, message }); } }; };
