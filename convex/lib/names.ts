// Company names (D56 and the Nov 19 rename): when two names count as the same. NFKC forms, invisible characters,
// spacing, case and lookalike Cyrillic/Greek letters are ignored, so "Hаrbor  Coffee" (Cyrillic а) is "harbor coffee".
/** D56 re-review N2: Cyrillic and Greek letters that look like Latin ones, so "Hаrbor" (Cyrillic а) is still "harbor". */
export const LOOKALIKE: Record<string, string> = Object.fromEntries([..."аеорсухіјѕԁӏкмнвтгɡοαερτυνικχ"].map((c, i) => [c, "aeopcyxijsdlkmhbtrgoaeptuvikx"[i]]));

export function nameKey(x: string): string {
  return [...x.normalize("NFKC").replace(/\p{Default_Ignorable_Code_Point}/gu, "").trim().replace(/\s+/g, " ").toLowerCase()].map((ch) => LOOKALIKE[ch] ?? ch).join("");
}
/** A typed name, tidied the same way before it's stored (format characters out, spaces collapsed). */
export function tidyName(x: string, max = 120): string {
  return x.normalize("NFKC").replace(/\p{Default_Ignorable_Code_Point}/gu, "").trim().replace(/\s+/g, " ").slice(0, max);
}
/** Review L3 (Nov 19): a lead-made company's "(website lead)" tag is Heston's note, never the client's name: it's left off
 *  wherever the name is copied onto something the client sees (contracts, quotes, proposals). */
export function shownName(x: string): string {
  return x.replace(/ \(website lead(?: \d+)?\)$/, "");
}
