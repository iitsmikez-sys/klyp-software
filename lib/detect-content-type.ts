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
