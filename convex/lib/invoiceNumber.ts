// D52 (Heston, Oct 29, 22:20): every business's invoices count up in one running sequence in its own Stripe account,
// numbered by Stripe with at least 4 digits. The prefix is the business name in capitals, letters and digits only,
// vowels (A E I O U) taken out, first 6 characters: Wrangler Productions → WRNGLR-0042, Juniper & Ash → JNPRSH,
// Joy Coffee → JYCFF (shorter names give shorter prefixes). A name of only vowels keeps its first letter. The
// portal sets it; a business can't change it. (Stripe allows 1–12 capital letters or numbers.)
export function invoicePrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const kept = letters.replace(/[AEIOU]/g, "");
  return (kept || letters.slice(0, 1) || "INV").slice(0, 6);
}
