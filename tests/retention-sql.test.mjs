import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.profiles (id uuid primary key);
    insert into public.profiles (id) values ('${USER}'), ('${OTHER}');
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/040_cancellation_retention.sql", import.meta.url), "utf8"));
  return db;
}
const claim = (db, user, offer, event = null) =>
  db.query("select public.claim_retention_offer($1, $2, 'sub_1', $3) as id", [user, event, offer]);
const finish = (db, id, status) => db.query("select public.finish_retention_offer($1, $2, 'sub_1')", [id, status]);

test("SQL: the discount is claimed once, then refused for 180 days with the date it returns", async () => {
  const db = await database();
  try {
    const first = (await claim(db, USER, "discount_40")).rows[0].id;
    await finish(db, first, "confirmed");
    await assert.rejects(claim(db, USER, "discount_40"), /discount_not_eligible:\d{4}-\d{2}-\d{2}/);
    // 179 days later: still refused. 181 days later: allowed again.
    await db.exec("update public.retention_offers set confirmed_at = now() - interval '179 days'");
    await assert.rejects(claim(db, USER, "discount_40"), /discount_not_eligible/);
    await db.exec("update public.retention_offers set confirmed_at = now() - interval '181 days'");
    assert.ok((await claim(db, USER, "discount_40")).rows[0].id);
  } finally { await db.close(); }
});

test("SQL: the limit is per person, not global", async () => {
  const db = await database();
  try {
    await finish(db, (await claim(db, USER, "discount_40")).rows[0].id, "confirmed");
    assert.ok((await claim(db, OTHER, "discount_40")).rows[0].id);
  } finally { await db.close(); }
});

test("SQL: a failed discount does not use up the 6 months, but an unfinished one blocks a second claim", async () => {
  const db = await database();
  try {
    const first = (await claim(db, USER, "discount_40")).rows[0].id;
    await assert.rejects(claim(db, USER, "discount_40"), /discount_not_eligible/); // still pending
    await finish(db, first, "failed");
    assert.ok((await claim(db, USER, "discount_40")).rows[0].id); // failed try forgiven
  } finally { await db.close(); }
});

test("SQL: two simultaneous claims -> exactly one succeeds", async () => {
  const db = await database();
  try {
    const results = await Promise.allSettled([claim(db, USER, "discount_40"), claim(db, USER, "discount_40")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rows = await db.query("select count(*)::int as n from public.retention_offers");
    assert.equal(rows.rows[0].n, 1);
  } finally { await db.close(); }
});

test("SQL: pauses are not limited by the 6 month rule, but only one can be in flight", async () => {
  const db = await database();
  try {
    const a = (await claim(db, USER, "pause_1")).rows[0].id;
    await assert.rejects(claim(db, USER, "pause_1"), /duplicate|unique/i);
    await finish(db, a, "confirmed");
    assert.ok((await claim(db, USER, "pause_2")).rows[0].id);
  } finally { await db.close(); }
});

test("SQL: a finished offer cannot be flipped again", async () => {
  const db = await database();
  try {
    const id = (await claim(db, USER, "pause_1")).rows[0].id;
    await finish(db, id, "confirmed");
    await finish(db, id, "failed");
    const r = await db.query("select status from public.retention_offers where id = $1", [id]);
    assert.equal(r.rows[0].status, "confirmed");
  } finally { await db.close(); }
});

test("SQL: unknown offers and bad input are refused; only the server (service role) may call the functions or read the tables", async () => {
  const db = await database();
  try {
    await assert.rejects(claim(db, USER, "free_year"), /invalid retention offer/);
    await assert.rejects(db.query("select public.claim_retention_offer(null, null, 'sub_1', 'discount_40')"), /invalid retention offer/);
    const priv = async (role, fn) => (await db.query(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).rows[0].ok;
    for (const fn of ["public.claim_retention_offer(uuid,uuid,text,text)", "public.finish_retention_offer(uuid,text,text)"]) {
      assert.equal(await priv("anon", fn), false);
      assert.equal(await priv("authenticated", fn), false);
      assert.equal(await priv("service_role", fn), true);
    }
    for (const table of ["public.cancellation_events", "public.retention_offers"]) {
      const r = await db.query(`select has_table_privilege('authenticated', '${table}', 'select') as sel, has_table_privilege('service_role', '${table}', 'insert') as ins`);
      assert.deepEqual([r.rows[0].sel, r.rows[0].ins], [false, true]);
    }
  } finally { await db.close(); }
});

test("SQL: survey rows only accept the five reasons, and feedback is capped at 1000 characters", async () => {
  const db = await database();
  try {
    const insert = (reason, detail = null) => db.query("insert into public.cancellation_events (user_id, reason, detail) values ($1, $2, $3)", [USER, reason, detail]);
    for (const r of ["not_good_clips", "break", "too_expensive", "not_using", "other"]) await insert(r);
    await assert.rejects(insert("bogus"), /violates check/);
    await assert.rejects(insert("other", "x".repeat(1001)), /violates check/);
  } finally { await db.close(); }
});
