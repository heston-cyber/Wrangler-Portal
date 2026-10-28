// Wrangler Portal — forwarding (Phase 0.5b, Oct 28).
// review.wranglerportal.com → app.wranglerportal.com, same path and query, permanently (links already sent keep
// working: /s/<token>, /s/<token>/v/<id>?version=&note=, /v/<id>, /x/<token>, /sign/…). The bare domain and www go
// to the app's front page for now (temporary), until wranglerportal.com gets its product page.
export const APP = "https://app.wranglerportal.com";

export function target(url) {
  const u = new URL(url);
  if (u.hostname === "review.wranglerportal.com") return { location: `${APP}${u.pathname}${u.search}`, status: 301 };
  return { location: `${APP}/`, status: 302 };
}

export default {
  async fetch(request) {
    const { location, status } = target(request.url);
    return new Response(null, { status, headers: { location, "cache-control": status === 301 ? "public, max-age=3600" : "no-store" } });
  },
};
