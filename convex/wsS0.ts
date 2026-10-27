// Wrangler Sign — Phase S0 checks (Oct 26). Throwaway: removed when Phase S1 starts.
// The repo and its Actions logs are public, so every function here returns statuses, sizes and short hash
// prefixes only: no email addresses, no IPs in logs, no keys.
//
//   wsS0:pdf        T-S0.1/T-S0.2 inside Convex: build a sample PDF, stamp it, add a certificate, hash twice.
//   wsS0:email      T-S0.4: the stamped PDF as an attachment, from contracts@wranglerportal.com, to the owner list.
//   wsS0:stripe     T-S0.5: a draft invoice in Stripe TEST mode (STRIPE_SIGN_KEY; refuses a live key).
//   GET /ws-s0/ip   T-S0.3: shows the caller the IP headers the backend received (to the caller only; not stored).
import { httpAction, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { stamp, inspect, sha256Bytes } from "./lib/wsPdf";
import { allowedEmails } from "./auth";

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.TimesRoman);
  const p = doc.addPage([612, 792]);
  const lines = [
    "SAMPLE AGREEMENT (Wrangler Sign S0 test, not a real contract)",
    "",
    "Scope of work & deliverables. A test document to prove stamping inside the backend.",
    "Initials: {{initials:client}}",
    "",
    "Signatures",
    "CLIENT: {{sign:client}}     Date: {{date:client}}",
  ];
  lines.forEach((t, i) => p.drawText(t, { x: 72, y: 700 - i * 22, size: 12, font: f }));
  doc.setCreationDate(new Date(Date.UTC(2000, 0, 1)));
  doc.setModificationDate(new Date(Date.UTC(2000, 0, 1)));
  return doc.save({ useObjectStreams: false });
}

// A 1x1 transparent PNG stands in for a signature image here (the visual check was done locally).
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

async function stampedSample() {
  const original = await samplePdf();
  const cert = ["WRANGLER SIGN - AUDIT CERTIFICATE (S0 TEST)", "", `Original SHA-256 ${await sha256Bytes(original)}`, "", "Test event lines would be listed here."];
  const stamps = [
    { box: { page: 0, x: 0.2, y: 0.07, w: 0.2, h: 0.03 }, kind: "image" as const, png: PNG },
    { box: { page: 0, x: 0.3, y: 0.24, w: 0.3, h: 0.05 }, kind: "image" as const, png: PNG },
    { box: { page: 0, x: 0.6, y: 0.24, w: 0.25, h: 0.03 }, kind: "text" as const, text: "October 26, 2026" },
  ];
  return { original, signed: await stamp(original, stamps, cert), again: await stamp(original, stamps, cert) };
}

export const pdf = internalAction({
  args: {},
  handler: async () => {
    const t0 = Date.now();
    const { original, signed, again } = await stampedSample();
    const ins = await inspect(signed);
    const h1 = await sha256Bytes(signed), h2 = await sha256Bytes(again);
    const flipped = signed.slice(); flipped[flipped.length >> 1] ^= 1;
    return {
      originalKB: Math.round(original.length / 1024), signedKB: Math.round(signed.length / 1024),
      signedPages: ins.ok ? ins.pages.length : ins.reason,
      sameBytesTwice: h1 === h2 && signed.length === again.length,
      oneByteChangesHash: (await sha256Bytes(flipped)) !== h1,
      sha12: h1.slice(0, 12), ms: Date.now() - t0,
    };
  },
});

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const email = internalAction({
  args: {},
  handler: async () => {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { configured: false };
    const { signed } = await stampedSample();
    const sha = await sha256Bytes(signed);
    const out: Array<{ to: string; status: number; id?: string; error?: string }> = [];
    for (const to of allowedEmails()) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: "Wrangler Productions <contracts@wranglerportal.com>",
          to: [to],
          reply_to: "heston@wranglerproductions.com",
          subject: "Wrangler Sign test: signed PDF attached",
          text: `This is a Wrangler Sign Phase S0 test, not a real contract.\n\nThe attached PDF stands in for a signed document. Its SHA-256 is:\n${sha}\n\nIf the attachment opens and this email is in your inbox (not spam), the test passed.\n\nWrangler Productions · sign.wranglerportal.com`,
          attachments: [{ filename: "WS-00000 Sample Agreement (signed).pdf", content: b64(signed) }],
          tags: [{ name: "kind", value: "ws-s0" }],
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
      out.push({ to: to.replace(/^(.).*@/, "$1…@"), status: r.status, id: j.id?.slice(0, 8), error: r.ok ? undefined : (j.message || "").slice(0, 120) });
    }
    return { configured: true, attachmentKB: Math.round(signed.length / 1024), sha12: sha.slice(0, 12), sent: out };
  },
});

// Stripe in TEST mode only: a customer and a DRAFT invoice. Never finalizes, sends or pays.
export const stripe = internalAction({
  args: { amountCents: v.optional(v.number()) },
  handler: async (_ctx, { amountCents }) => {
    const key = process.env.STRIPE_SIGN_KEY;
    if (!key) return { configured: false };
    if (!/^(sk|rk)_test_/.test(key)) return { configured: true, refused: "S0 runs in test mode only; this key isn't a test key." };
    const restricted = key.startsWith("rk_");
    const api = async (path: string, form: Record<string, string>) => {
      const r = await fetch(`https://api.stripe.com/v1/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", "Idempotency-Key": `ws-s0-${path}-${form["metadata[ws_doc]"] ?? ""}-${Date.now()}` },
        body: new URLSearchParams(form).toString(),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, any>;
      return { status: r.status, j };
    };
    const doc = `WS-S0-${Date.now()}`;
    const cust = await api("customers", { name: "Wrangler Sign test customer", email: "test-customer@example.com", "metadata[ws_doc]": doc });
    if (cust.status !== 200) return { configured: true, restricted, step: "customer", status: cust.status, error: String(cust.j.error?.message ?? "").slice(0, 160) };
    const inv = await api("invoices", {
      customer: cust.j.id, collection_method: "send_invoice", days_until_due: "3", auto_advance: "false",
      description: "Deposit on signing (Wrangler Sign S0 test)", "metadata[ws_doc]": doc,
    });
    if (inv.status !== 200) return { configured: true, restricted, step: "invoice", status: inv.status, error: String(inv.j.error?.message ?? "").slice(0, 160) };
    const item = await api("invoiceitems", { customer: cust.j.id, invoice: inv.j.id, amount: String(amountCents ?? 120000), currency: "usd", description: "Deposit (S0 test)", "metadata[ws_doc]": doc });
    if (item.status !== 200) return { configured: true, restricted, step: "item", status: item.status, error: String(item.j.error?.message ?? "").slice(0, 160) };
    const check = await fetch(`https://api.stripe.com/v1/invoices/${inv.j.id}`, { headers: { Authorization: `Bearer ${key}` } });
    const c = (await check.json()) as Record<string, any>;
    return { configured: true, restricted, livemode: c.livemode, status: c.status, auto_advance: c.auto_advance, collection: c.collection_method, total: c.total, emailed: !!c.status_transitions?.finalized_at };
  },
});

// Shows the caller which IP-carrying headers reached the backend. Nothing is stored or logged.
export const ip = httpAction(async (_ctx, req) => {
  const names = ["x-forwarded-for", "x-real-ip", "cf-connecting-ip", "true-client-ip", "forwarded", "x-client-ip", "fly-client-ip", "x-envoy-external-address"];
  const seen: Record<string, string> = {};
  for (const n of names) { const val = req.headers.get(n); if (val) seen[n] = val; }
  const other: string[] = []; req.headers.forEach((_v, k) => { if (!names.includes(k)) other.push(k); }); other.sort();
  const body = { note: "Wrangler Sign S0 test. Compare with https://whatismyipaddress.com. Not stored.", ipHeaders: seen, otherHeaderNames: other };
  if ((req.headers.get("accept") || "").includes("text/html")) {
    const rows = Object.entries(seen).map(([k, val]) => `<tr><td>${k}</td><td><b>${val.replace(/</g, "&lt;")}</b></td></tr>`).join("") || "<tr><td colspan=2>No IP headers arrived.</td></tr>";
    return new Response(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Wrangler Sign IP test</title><body style="font:16px -apple-system,Helvetica;padding:20px;max-width:640px"><h2>Wrangler Sign: IP test</h2><p>This is the address the backend sees for you. Compare it with <a href="https://whatismyipaddress.com">whatismyipaddress.com</a> (IPv4 or IPv6). Nothing here is saved.</p><table cellpadding=6 border=1 style="border-collapse:collapse">${rows}</table></body>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
});
