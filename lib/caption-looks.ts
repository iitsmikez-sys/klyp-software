/**
 * The newer caption looks (Hype, Pop, Fire) and the helpers the preview and the export share, so a
 * clip looks the same in the browser as in the downloaded video.
 *
 *  - Keyword, Hype and Fire show a short phrase and light up one word at a time (green, red, neon green).
 *  - Klyp, Spark and Pop show one word at a time.
 *  - Fire also adds an emoji that matches the words, drawn with the bundled Noto Emoji font as a flat icon.
 */
import type { CaptionStyle } from "./clips";

const highlight = (css: string) => ({ css, ass: "&H00" + css.slice(5, 7) + css.slice(3, 5) + css.slice(1, 3) + "&" });
const HIGHLIGHT: Partial<Record<CaptionStyle, { css: string; ass: string }>> = {
  KEYWORD: highlight("#00E5A0"),
  HYPE: highlight("#FF2D2D"),
  FIRE: highlight("#39FF3A"),
  // Tri-color paints every word in turn green, red or white (see wordLook), so this entry is only a fallback.
  TRICOLOR: highlight("#1FFF3A"),
};

/** Tri-color rotation: bright green, bright red, white, repeating word by word. */
const TRICOLOR_WORDS = [highlight("#1FFF3A"), highlight("#FF1F2A"), highlight("#FFFFFF")];
/** The active Tri-color word is drawn a little larger than the rest. */
export const TRICOLOR_ACTIVE_SCALE = 1.18;

/** Color of one word: the phrase is white and the active word lights up, or, for Tri-color, a fixed rotation by position. */
export function wordLook(style: CaptionStyle, index: number, active: boolean): { css: string; ass: string } {
  if (style === "TRICOLOR") return TRICOLOR_WORDS[index % TRICOLOR_WORDS.length];
  return active ? highlightColor(style) : WHITE_WORD;
}
const WHITE_WORD = highlight("#FFFFFF");
export const activeWordScale = (style: CaptionStyle) => (style === "TRICOLOR" ? TRICOLOR_ACTIVE_SCALE : 1);

/** Phrase styles where one word at a time takes the highlight color. */
export const isHighlightStyle = (style: CaptionStyle) => style in HIGHLIGHT;
export const highlightColor = (style: CaptionStyle) => HIGHLIGHT[style] ?? HIGHLIGHT.KEYWORD!;
/** Styles that show a single word per caption. */
export const isOneWordStyle = (style: CaptionStyle) => style === "KLYP" || style === "SPARK" || style === "POP";
/** Styles with their own colors, so the color picker does not apply. */
export const hasFixedPalette = (style: CaptionStyle) => style === "COMIC" || isHighlightStyle(style);

export const EMOJI_FONT = "Noto Emoji";
const EMOJIS: { char: string; color: string; words: string[] }[] = [
  { char: "🔥", color: "#FF8A1F", words: ["fire", "lit", "hot", "burn", "burning", "insane", "crazy"] },
  { char: "💀", color: "#FFFFFF", words: ["dead", "died", "die", "dying", "kill", "killed", "death"] },
  { char: "😂", color: "#FFD93B", words: ["laugh", "laughing", "funny", "lol", "lmao", "haha", "hilarious"] },
  { char: "🤯", color: "#FFD93B", words: ["mind", "wtf", "unreal", "wild", "shocked"] },
  { char: "💰", color: "#5BE37D", words: ["money", "cash", "rich", "dollar", "dollars", "paid", "bag"] },
  { char: "💯", color: "#FF4D4D", words: ["hundred", "perfect", "facts", "exactly"] },
  { char: "👀", color: "#FFFFFF", words: ["look", "watch", "eyes", "see", "seen"] },
  { char: "😭", color: "#5FD6FF", words: ["cry", "crying", "sad", "tears"] },
  { char: "🏆", color: "#FFD93B", words: ["win", "won", "winning", "champion", "first"] },
  { char: "😱", color: "#FFD93B", words: ["scared", "scary", "ghost", "afraid", "terrified"] },
];

const clean = (word: string) => word.toLowerCase().replace(/[^a-z]/g, "");

/** The emoji for the first matching word in a caption, or null. */
export function emojiForText(text: string): { char: string; color: string } | null {
  for (const word of text.split(/\s+/)) {
    const w = clean(word);
    const hit = w && EMOJIS.find((e) => e.words.includes(w));
    if (hit) return { char: hit.char, color: hit.color };
  }
  return null;
}

/** ASS color (&HAABBGGRR) from a #RRGGBB value. */
export const assColorOf = (css: string) => "&H00" + css.slice(5, 7) + css.slice(3, 5) + css.slice(1, 3) + "&";

/** Styles whose captions are drawn in capitals (the one-word styles plus Hype and Fire). */
export const isUppercaseStyle = (style: CaptionStyle) => isOneWordStyle(style) || style === "HYPE" || style === "FIRE" || style === "TRICOLOR";
