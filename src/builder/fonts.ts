// Fonts for built documents (B2): the same files drive the builder's page on screen (FontFace) and the PDF
// (@react-pdf/renderer's Font.register). Files live in Convex storage (convex/builder.ts › wsFonts).
export type FontRow = { _id: string; family: string; weight: number; italic: boolean; url: string | null; source: string; fileName: string };

const screenLoaded = new Set<string>();
/** Makes the family usable in CSS on this page. */
export async function loadForScreen(rows: FontRow[]) {
  for (const r of rows) {
    const key = `${r.family}|${r.weight}|${r.italic}`;
    if (!r.url || screenLoaded.has(key)) continue;
    screenLoaded.add(key);
    try {
      const f = new FontFace(`WS ${r.family}`, `url(${r.url})`, { weight: String(r.weight), style: r.italic ? "italic" : "normal" });
      await f.load();
      document.fonts.add(f);
    } catch { screenLoaded.delete(key); }
  }
}
/** The CSS font-family for a family on screen (falls back to the system font while it loads). */
export const cssFamily = (family: string) => `"WS ${family}", ${family.includes("Mono") ? "ui-monospace, Menlo, monospace" : /Lora|Serif|Garamond|Times/i.test(family) ? "Georgia, serif" : "system-ui, sans-serif"}`;

/** Local Font Access (Chrome and Edge on a computer): the fonts installed on this machine. */
export type LocalFont = { family: string; fullName: string; postscriptName: string; style: string; blob: () => Promise<Blob> };
export const canReadLocalFonts = () => typeof window !== "undefined" && "queryLocalFonts" in window;
export async function localFonts(): Promise<LocalFont[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (await (window as any).queryLocalFonts()) as LocalFont[];
  return list;
}
/** Weight and italic from a local font's style name ("Bold Italic", "SemiBold" …). */
export function styleOf(style: string): { weight: number; italic: boolean } {
  const s = style.toLowerCase();
  const weight = /black|heavy/.test(s) ? 900 : /extra ?bold|ultra ?bold/.test(s) ? 800 : /semi ?bold|demi/.test(s) ? 600 : /bold/.test(s) ? 700 : /medium/.test(s) ? 500 : /extra ?light|ultra ?light/.test(s) ? 200 : /light/.test(s) ? 300 : /thin|hairline/.test(s) ? 100 : 400;
  return { weight, italic: /italic|oblique/.test(s) };
}

// A short list of good Google fonts to pick from (any other family can be typed in).
export const GOOGLE_PICKS = ["Inter", "Lora", "Nunito", "JetBrains Mono", "Playfair Display", "Merriweather", "Source Serif 4", "EB Garamond", "Libre Baskerville", "DM Sans", "Work Sans", "Manrope", "Space Grotesk", "IBM Plex Sans", "IBM Plex Serif", "Montserrat", "Poppins", "Raleway", "Saira", "Oswald", "Archivo", "Crimson Pro", "Cormorant Garamond", "Fraunces"];
