// Phase 2 Part B (D45): Stripe Connect. One platform key (STRIPE_PLATFORM_KEY, the portal's own Stripe account) acts
// for every business; each business's calls carry its connected account (the Stripe-Account header), so money goes
// straight to the business, never through the platform. Plain fetch, as Wrangler Sign's Stripe drafts do.

export type StripeResult = Record<string, any>;

export function platformKey(): string | null {
  return process.env.STRIPE_PLATFORM_KEY || null;
}

/** test or live, from the key, so screens can say "test mode". */
export const keyMode = (key: string | null) => (key ? (key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test") : null);

/** Flattens { a: { b: 1 }, c: [x, y] } into Stripe's form fields: a[b]=1, c[0]=x, c[1]=y. */
export function formOf(obj: Record<string, unknown>, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" && x !== null ? formOf(x as Record<string, unknown>, `${key}[${i}]`, out) : (out[`${key}[${i}]`] = String(x))));
    else if (typeof v === "object") formOf(v as Record<string, unknown>, key, out);
    else out[key] = String(v);
  }
  return out;
}

export const STRIPE_VERSION = "2025-05-28.basil";

export class StripeError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) { super(message); }
}

export async function stripeCall(method: "GET" | "POST" | "DELETE", path: string, opts: { form?: Record<string, unknown>; account?: string; idem?: string; key?: string } = {}): Promise<StripeResult> {
  const key = opts.key ?? platformKey();
  if (!key) throw new StripeError("Payments aren't set up on the portal yet (no platform Stripe key).", 0, "no_key");
  const params = opts.form ? new URLSearchParams(formOf(opts.form)).toString() : undefined;
  // GET carries its fields (expand[], filters) in the address; POST in the body.
  const body = method === "GET" ? undefined : params;
  const url = `https://api.stripe.com/v1/${path}${method === "GET" && params ? `${path.includes("?") ? "&" : "?"}${params}` : ""}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      // The same version the Connect webhook destination sends (Invoice Payments and confirmation_secret are basil's).
      "Stripe-Version": STRIPE_VERSION,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.account ? { "Stripe-Account": opts.account } : {}),
      ...(opts.idem ? { "Idempotency-Key": opts.idem } : {}),
    },
    body,
  });
  const j = (await r.json().catch(() => ({}))) as StripeResult;
  if (!r.ok) throw new StripeError(`Stripe: ${String(j.error?.message ?? r.statusText).slice(0, 200)}`, r.status, j.error?.code ?? null);
  return j;
}

// ---------- webhook signatures ----------

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Checks a Stripe-Signature header (t=…,v1=…) against the endpoint's signing secret. Refuses anything older than
 *  five minutes, so a captured request can't be replayed later. */
export async function stripeSignatureOk(payload: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > 300) return false;
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${t}.${payload}`)));
  return sigs.some((s) => s.length === want.length && timingSafe(s, want));
}

function timingSafe(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Builds a valid header, for tests. */
export async function signForTest(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${t},v1=${hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${t}.${payload}`)))}`;
}

// ---------- the connected account's state ----------

export type StripeStatus = "pending" | "needs_info" | "connected" | "disconnected";

/** What the Settings page shows, from a Stripe account object. */
/** The ways a client can pay this account's invoices (card covers Apple Pay and Google Pay). */
export function methodsOf(a: StripeResult): string[] {
  const caps = (a.capabilities ?? {}) as Record<string, string>;
  return ["card", ...(caps.us_bank_account_ach_payments === "active" ? ["us_bank_account"] : []), ...(caps.link_payments === "active" ? ["link"] : [])];
}

export function accountState(a: StripeResult) {
  const charges = !!a.charges_enabled, payouts = !!a.payouts_enabled, submitted = !!a.details_submitted;
  const dueList = [...new Set([...((a.requirements?.past_due as string[] | undefined) ?? []), ...((a.requirements?.currently_due as string[] | undefined) ?? [])])];
  const due = dueList.length;
  const pending = ((a.requirements?.pending_verification as string[] | undefined) ?? []).length;
  const bank = (a.external_accounts?.data as Array<{ last4?: string }> | undefined)?.[0]?.last4 ?? null;
  const status: StripeStatus = charges && submitted && due === 0 ? "connected" : submitted || due > 0 ? "needs_info" : "pending";
  return {
    status, chargesEnabled: charges, payoutsEnabled: payouts, detailsSubmitted: submitted,
    displayName: (a.business_profile?.name as string | undefined) || (a.settings?.dashboard?.display_name as string | undefined) || null,
    bankLast4: bank, livemode: !!a.livemode,
    // What Stripe is still asking for (field names), why payments are off, and whether it's only checking.
    due: dueList.slice(0, 20), disabledReason: (a.requirements?.disabled_reason as string | undefined) ?? null, verifying: pending > 0,
    methods: methodsOf(a),
  };
}
