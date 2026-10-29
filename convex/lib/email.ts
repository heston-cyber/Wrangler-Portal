// Outgoing email through Resend (client side, Oct 23). From review@wranglerportal.com (verified domain); replies
// go to Heston. RESEND_API_KEY is in the Convex dashboard. Returns the Resend id or throws.
export const FROM = () => process.env.EMAIL_FROM || "Wrangler Review <review@wranglerportal.com>";
export const REPLY_TO = () => process.env.EMAIL_REPLY_TO || "heston@wranglerproductions.com";
export { SITE } from "./site";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// A plain HTML twin of the text (mail filters trust multipart text+HTML more than text alone): paragraphs kept,
// links clickable, nothing fancy.
export function htmlFromText(text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => esc(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<&]+(?:&amp;[^\s<&]+)*)/g, '<a href="$1" style="color:#c8102e">$1</a>'));
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font:15px/1.55 -apple-system,Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto">${paras.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join("")}</div></body></html>`;
}

export async function sendEmail(msg: { to: string; subject: string; text: string; html?: string; replyTo?: string | null; tag?: string; unsubscribe?: string; from?: string; attachments?: Array<{ filename: string; content: string }> }): Promise<string> {
  // The preview (Phase 1, Oct 29): on a deployment with EMAIL_ONLY_TO set (the dev copy of live data), email goes only
  // to those addresses. Anyone else's email is held: nothing is sent, and the caller sees an ordinary success.
  const only = (process.env.EMAIL_ONLY_TO ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (only.length && !only.includes(msg.to.trim().toLowerCase())) { console.log(`email held (preview): ${msg.tag ?? "email"}`); return "held"; }
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email isn't set up (no Resend key).");
  const body: Record<string, unknown> = { from: msg.from ?? FROM(), to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html ?? htmlFromText(msg.text) };
  if (msg.attachments?.length) body.attachments = msg.attachments;
  if (msg.unsubscribe) body.headers = { "List-Unsubscribe": `<${msg.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  if (msg.replyTo !== null) body.reply_to = msg.replyTo ?? REPLY_TO();
  if (msg.tag) body.tags = [{ name: "kind", value: msg.tag }];
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})) as { id?: string; message?: string };
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(j.message || "").slice(0, 160)}`);
  return j.id ?? "";
}

export const sixDigits = () => { const b = new Uint32Array(1); crypto.getRandomValues(b); return String(100000 + (b[0] % 900000)); };
