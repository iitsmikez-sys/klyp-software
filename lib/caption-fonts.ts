/**
 * Browser side of the bundled caption fonts (public/fonts, declared in app/globals.css). A canvas
 * draws with a fallback until a font has loaded, so the previews ask for all of them up front.
 */
export const CAPTION_FONT_FAMILIES = ["Poppins ExtraBold", "Poppins SemiBold", "Anton", "Archivo Black", "Noto Emoji"] as const;

let requested = false;
export function ensureCaptionFonts(): void {
  if (requested || typeof document === "undefined" || !document.fonts) return;
  requested = true;
  for (const family of CAPTION_FONT_FAMILIES) void document.fonts.load(`32px "${family}"`).catch(() => { /* fallback font is used */ });
}
