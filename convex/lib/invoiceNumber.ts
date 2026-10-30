// D52 (Heston, Oct 29): every business's invoices count up in one running sequence, prefixed with the business name
// in capitals, letters and digits only, vowels (A E I O U) taken out, as one word, at most 12 characters (Stripe's
// limit). A name of only vowels keeps its first letter.
// OPEN (asked Oct 29): which name goes in. "Juniper & Ash" → JNPRSH uses the whole name, but Wrangler's example is
// WRNGLR, while its business name is "Wrangler Productions" (→ WRNGLRPRDCTN). Not used until that's settled.
export function invoicePrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const kept = letters.replace(/[AEIOU]/g, "");
  return (kept || letters.slice(0, 1) || "INV").slice(0, 12);
}
