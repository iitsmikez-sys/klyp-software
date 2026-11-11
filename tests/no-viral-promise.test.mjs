import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

test("no page promises 'viral': the score is called Virality Score and said to be an estimate, and nothing says viral clips or going viral", () => {
  const found = [];
  for (const file of [...files(path.join(root, "app")), ...files(path.join(root, "components"))]) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      const code = line.trim();
      if (/^(\/\/|\*|\/\*|\{\/\*)/.test(code)) return; // comments are not shown to anyone
      if (/viral(?!ity score|_score|Score)/i.test(code) || /(go|going|goes|gone) viral|viral (clips|moments|content|videos)/i.test(code)) found.push(`${path.relative(root, file)}:${i + 1}: ${code.slice(0, 90)}`);
    });
  }
  assert.deepEqual(found, [], "words people read must not say viral");
});

test("the score disclaimer stays honest: it says the score is an estimate, not a promise of views", () => {
  const streams = readFileSync(path.join(root, "app/(dashboard)/dashboard/streams/page.tsx"), "utf8");
  assert.ok(streams.includes("Virality Score is Klyp&apos;s own estimate of how strong each clip is. It&apos;s an estimate, not a promise of views."));
  const badge = readFileSync(path.join(root, "components/ScoreBadge.tsx"), "utf8");
  assert.ok(badge.includes("not a measured result"));
});
