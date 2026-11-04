import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

async function database() {
  const db = new PGlite();
  await db.exec(`create table public.profiles (id uuid primary key, created_at timestamptz not null default now());
    insert into public.profiles (id) values ('11111111-1111-4111-8111-111111111111');`);
  const sql = await readFile(new URL("../supabase/migrations/044_acquisition_source.sql", import.meta.url), "utf8");
  await db.exec(sql);
  return db;
}

test("existing accounts get an empty source, and the migration can be applied twice", async () => {
  const db = await database();
  await db.exec(await readFile(new URL("../supabase/migrations/044_acquisition_source.sql", import.meta.url), "utf8"));
  const { rows } = await db.query("select acquisition_source from public.profiles");
  assert.deepEqual(rows, [{ acquisition_source: null }]);
});

test("a short lowercase source is accepted and anything else is refused", async () => {
  const db = await database();
  for (const ok of ["tiktok", "offer-17", "example-blog.com", "email_1"]) {
    await db.query("update public.profiles set acquisition_source = $1", [ok]);
  }
  for (const bad of ["TikTok", "has space", "a".repeat(33), "<script>", ""]) {
    await assert.rejects(db.query("update public.profiles set acquisition_source = $1", [bad]), /acquisition_source_format/);
  }
});
