/** Confirm a signed-in user cannot render an unowned, unanalyzed source. */
import { loginExistingTestAccount } from "./smoke-auth.mjs";

const [, , email, base = "http://127.0.0.1:3025"] = process.argv;
const { token } = await loginExistingTestAccount(email);
const body = {
  clip_id: "00000000-0000-4000-8000-000000000001",
  url: `https://www.twitch.tv/videos/${Date.now()}`,
  start_seconds: 0,
  end_seconds: 10,
};
for (const endpoint of ["preview", "thumbnail", "clip"]) {
  const response = await fetch(`${base}/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (response.status !== 403) throw new Error(`${endpoint} expected 403, received ${response.status} (${response.headers.get("content-type")}).`);
  console.log(JSON.stringify({ endpoint, unownedSourceDenied: true }));
}
