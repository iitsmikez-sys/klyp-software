/**
 * Picks Gaming or IRL from a video's title, so the wrong setting cannot make Klyp hunt for story moments in a game stream (or
 * the other way round). It only reads the title; a title that says nothing falls back to the default. No imports on purpose.
 */
export type DetectedContent = "gaming" | "irl";

const IRL = /\b(irl|just chatting|vlog|podcast|q\s*&\s*a|asmr|cooking|travel|walking tour|talk show|storytime|story time)\b/i;
const GAMING =
  /\b(gta|gta\s?v|gta\s?5|nopixel|rp|valorant|fortnite|minecraft|warzone|call of duty|cod|apex|cs2|csgo|counter[- ]strike|league of legends|lol|roblox|elden ring|fifa|nba 2k|rust|tarkov|overwatch|rocket league|dota|wow|world of warcraft|marvel rivals|gameplay|speedrun|ranked|playing|game|games|gaming|raid|lobby|hardcore|survival|battle royale)\b/i;

export function detectContentType(title: string | null | undefined): DetectedContent | null {
  const text = (title ?? "").trim();
  if (!text) return null;
  const gaming = GAMING.test(text);
  const irl = IRL.test(text);
  if (gaming && !irl) return "gaming";
  if (irl && !gaming) return "irl";
  return null;
}

/**
 * For a title that says nothing: guess Gaming or IRL from what is SAID. Game talk has words like "kill", "round", "loot", "squad",
 * "respawn", "boss", "ranked"; a talking stream has almost none. Counts those words per 1,000 spoken words. No imports on purpose.
 */
const GAME_WORDS = new Set([
  "kill", "kills", "killed", "killing", "dead", "died", "revive", "respawn", "spawn", "spawned", "round", "rounds", "lobby", "squad", "team",
  "teammate", "teammates", "enemy", "enemies", "loot", "ammo", "reload", "headshot", "sniper", "shotgun", "rifle", "gun", "guns", "shoot", "shooting",
  "shot", "boss", "level", "quest", "dungeon", "raid", "ranked", "rank", "elo", "match", "matchmaking", "queue", "clutch", "ace", "ult", "ultimate",
  "cooldown", "heal", "healer", "tank", "dps", "buff", "nerf", "meta", "loadout", "gameplay", "controller", "keybind", "fps", "ping", "lag", "cops",
  "police", "heist", "robbery", "dispatch", "gang", "turf", "inventory", "craft", "crafting", "build", "builds", "storm", "zone", "drop", "wipe",
  "rotate", "push", "peek", "flank", "peeking", "aim", "recoil", "spray", "damage", "hp", "xp", "gg",
]);

export function gamingDensity(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return 0;
  let hits = 0;
  for (const w of words) if (GAME_WORDS.has(w)) hits++;
  return (hits / words.length) * 1000;
}

/** Gaming at or above this many game words per 1,000 words; below it the stream is mostly talking. */
export const GAMING_DENSITY_MIN = 6;
const MIN_WORDS_TO_JUDGE = 500;

/** null when there is too little speech to tell, so the default stays. */
export function detectContentFromTranscript(text: string): DetectedContent | null {
  const count = (text.match(/[A-Za-z']+/g) ?? []).length;
  if (count < MIN_WORDS_TO_JUDGE) return null;
  return gamingDensity(text) >= GAMING_DENSITY_MIN ? "gaming" : "irl";
}
