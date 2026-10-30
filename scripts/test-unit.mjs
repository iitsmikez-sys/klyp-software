import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names = (await readdir(path.join(root, "tests")))
  .filter((name) => name.endsWith(".mjs") && name !== "homepage-demo.mjs" && name !== "analysis-reconnect.browser.mjs")
  .sort();
const child = spawn(process.execPath, ["--test", ...names.map((name) => path.join(root, "tests", name))],
  { stdio: "inherit" });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
