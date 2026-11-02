// Pay in portal (Heston, Nov 2: "I just need to be able to pay my vendors"). Stripe Global Payouts on the business's
// OWN Stripe account (not through the portal's Connect platform): a restricted key from that account in
// STRIPE_PAYOUTS_KEY, used only for the default business (Wrangler). Money goes from the business's Stripe balance
// (a Treasury financial account it funds from its bank) straight to the vendor's bank by ACH. Vendors enter their
// bank details on Stripe's own form; the portal never sees them (D101). Plain fetch, JSON (the v2 APIs).

export type V2 = Record<string, any>;
export const PAYOUTS_VERSION = "2026-09-30.preview";

export function payoutsKey(): string | null {
  return process.env.STRIPE_PAYOUTS_KEY || null;
}
export const payoutsMode = () => {
  const k = payoutsKey();
  return k ? (/_live_/.test(k) ? "live" : "test") : null;
};

export class PayoutsError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); }
}

/** One v2 call. `context` is the Stripe-Context header (a recipient's account, for its payout methods). */
export async function payoutsCall(method: "GET" | "POST", path: string, opts: { body?: Record<string, unknown>; query?: Array<[string, string]>; context?: string; idem?: string } = {}): Promise<V2> {
  const key = payoutsKey();
  if (!key) throw new PayoutsError("Paying vendors in the portal isn't connected yet (Settings › Payments › Vendor payouts).", 0, "no_key");
  const qs = opts.query?.length ? `?${new URLSearchParams(opts.query).toString()}` : "";
  const r = await fetch(`https://api.stripe.com/v2/${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": PAYOUTS_VERSION,
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.context ? { "Stripe-Context": opts.context } : {}),
      ...(opts.idem ? { "Idempotency-Key": opts.idem } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = (await r.json().catch(() => ({}))) as V2;
  if (!r.ok) throw new PayoutsError(`Stripe: ${String(j.error?.message ?? r.statusText).slice(0, 200)}`, r.status, j.error?.code ?? null);
  return j;
}

/** The business's USD financial account and what's available to pay out now. */
export async function financialAccount(): Promise<{ id: string; availableCents: number } | null> {
  const r = await payoutsCall("GET", "money_management/financial_accounts");
  const open = (r.data ?? []).filter((x: V2) => x.status !== "closed");
  const fa = open.find((x: V2) => x.balance?.available?.usd || (x.storage?.holds_currencies ?? []).includes("usd")) ?? open[0];
  if (!fa) return null;
  return { id: fa.id, availableCents: Number(fa.balance?.available?.usd?.value ?? 0) };
}

/** A vendor's recipient account: is ACH active, and which bank account will it go to. */
export async function recipientState(recipientId: string): Promise<{ ready: boolean; needsInfo: boolean; payoutMethodId: string | null; last4: string | null; bankName: string | null }> {
  // Not checked against a live sandbox yet (Heston's sandbox run): v2 lists use include[0]=…; if Stripe ignores these,
  // the recipient settings come back empty and the vendor never shows ready (fails safe, pays nothing).
  const acct = await payoutsCall("GET", `core/accounts/${recipientId}`, { query: [["include[0]", "configuration.recipient"], ["include[1]", "requirements"], ["include[2]", "defaults"]] });
  const ach = acct.configuration?.recipient?.capabilities?.bank_accounts?.ach?.status ?? null;
  const pms = await payoutsCall("GET", "money_management/payout_methods", { context: recipientId });
  // The recipient's default for USD, else their only usable bank account. A method Stripe marks anything but
  // eligible (requires_action, invalid) is never paid to.
  const usable = (pms.data ?? []).filter((m: V2) => m.type === "bank_account" && (m.usage_status?.payments === undefined || m.usage_status.payments === "eligible"));
  const def = acct.defaults?.payout_methods?.usd ?? acct.configuration?.recipient?.default_outbound_destination?.id ?? null;
  const bank = (def ? usable.find((m: V2) => m.id === def) : null) ?? (usable.length === 1 ? usable[0] : null);
  const restricted = (acct.requirements?.entries ?? []).some((e: V2) => (e.impact?.restricts_capabilities ?? []).length > 0);
  return {
    ready: ach === "active" && !!bank,
    needsInfo: restricted || !bank, // several accounts and no default: they pick one on Stripe's form
    payoutMethodId: bank?.id ?? null,
    last4: bank?.bank_account?.last4 ?? null,
    bankName: bank?.bank_account?.bank_name ?? null,
  };
}
