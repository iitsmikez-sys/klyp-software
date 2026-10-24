/** Find current public Gaming and Just Chatting VODs for release smoke tests. */
const id = process.env.TWITCH_CLIENT_ID;
const secret = process.env.TWITCH_CLIENT_SECRET;
if (!id || !secret) throw new Error("Twitch app credentials are required.");
const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
});
if (!tokenResponse.ok) throw new Error(`Twitch token: HTTP ${tokenResponse.status}`);
const token = (await tokenResponse.json()).access_token;
async function get(path) {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, {
    headers: { "Client-Id": id, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Twitch ${path}: HTTP ${response.status}`);
  return response.json();
}
for (const category of ["Minecraft", "Just Chatting"]) {
  const games = await get(`games?name=${encodeURIComponent(category)}`);
  const gameId = games.data?.[0]?.id;
  if (!gameId) throw new Error(`Missing Twitch category: ${category}`);
  const videos = await get(`videos?game_id=${gameId}&type=archive&language=en&sort=views&period=week&first=100`);
  const rows = videos.data.map((video) => ({
    id: video.id, title: video.title, duration: video.duration,
    published_at: video.published_at, url: video.url,
  }));
  const seconds = (duration) => [...duration.matchAll(/(\d+)([hms])/g)]
    .reduce((sum, [, amount, unit]) => sum + Number(amount) * ({ h: 3600, m: 60, s: 1 })[unit], 0);
  const moderate = rows.filter((row) => seconds(row.duration) >= 1200 && seconds(row.duration) <= 5400);
  console.log(JSON.stringify({ category, candidates: moderate.slice(0, 5) }, null, 2));
}
