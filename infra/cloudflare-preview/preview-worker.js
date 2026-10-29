// preview.wranglerportal.com (Phase 1, Oct 29): a password page in front of the preview build. Every request, files
// included, needs the cookie a right password sets. No password set (the PREVIEW_PASSWORD secret) = locked for all.
const COOKIE = "wp_preview";
const DAYS = 30;

const enc = new TextEncoder();
async function proof(secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("wrangler-preview-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const cookieOf = (req) => (req.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || "";
const SEC = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "x-content-type-options": "nosniff", "strict-transport-security": "max-age=31536000" };

function page(msg, status = 401) {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Preview · WranglerPortal</title>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#030104 radial-gradient(120% 70% at 50% -10%,rgba(160,10,0,.55),rgba(3,1,4,0) 70%);color:#F4F1E9;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;padding:16px;box-sizing:border-box">
<form method="post" action="/__preview" style="width:100%;max-width:420px;padding:32px;border-radius:24px;border:1px solid rgba(244,241,233,.75);background:rgba(3,1,4,.34);display:grid;gap:14px">
<span style="font:500 12px/1 Helvetica,Arial,sans-serif;letter-spacing:.48px;text-transform:uppercase;color:#FF0000">Preview</span>
<h1 style="margin:0;font:600 24px/1.1 Helvetica,Arial,sans-serif">WranglerPortal preview.</h1>
<p style="margin:0;color:rgba(244,241,233,.78)">${msg}</p>
<input name="password" type="password" autocomplete="current-password" autofocus aria-label="Password" style="height:44px;border-radius:12px;border:1px solid rgba(244,241,233,.28);background:#0b0b0d;color:#F4F1E9;padding:0 14px;font:inherit">
<input type="hidden" name="next" value="">
<button style="height:44px;border:0;border-radius:12px;background:#FF0000;color:#F4F1E9;font:15px Helvetica,Arial,sans-serif;cursor:pointer">Open</button>
</form><script>document.querySelector('[name=next]').value=location.pathname+location.search</script></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SEC } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.PREVIEW_PASSWORD) return page("This preview is locked until its password is set.", 503);
    const want = await proof(env.PREVIEW_PASSWORD);
    if (url.pathname === "/__preview" && request.method === "POST") {
      const form = await request.formData().catch(() => null);
      const pw = String(form?.get("password") || "");
      const next = String(form?.get("next") || "/");
      if (!same(await proof(pw), want)) { await new Promise((r) => setTimeout(r, 1200)); return page("That password didn't match. Try again."); }
      const to = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
      return new Response(null, { status: 303, headers: { location: to, "set-cookie": `${COOKIE}=${want}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`, ...SEC } });
    }
    if (!same(cookieOf(request), want)) return page("Type the preview password.");
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SEC)) out.headers.set(k, v);
    if ((out.headers.get("content-type") || "").includes("text/html")) out.headers.set("cache-control", "no-store");
    return out;
  },
};
