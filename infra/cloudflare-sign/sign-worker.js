// Wrangler Sign — sign.wranglerportal.com (S2, Oct 27).
// The signing page is part of the same site as Wrangler Review (GitHub Pages). This Worker serves that site on its
// own address: every page path gets the app's index.html (the app sees the sign. host and shows only the signing
// page), files (/assets/…, /brand/…) pass through. It adds the headers a signing page should have: no framing (so it
// can't be hidden inside another site), no referrer (the address holds the signer's token), no search indexing, and
// no caching of the page itself.
const ORIGIN = "https://review.wranglerportal.com";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const isFile = /\.[a-z0-9]{1,8}$/i.test(url.pathname);
    // Only the app's own files and pages; the lab pages and anything else stay on the review site.
    if (isFile && !/^\/(assets|brand)\//.test(url.pathname) && url.pathname !== "/favicon.png") return new Response("Not found", { status: 404 });
    const upstream = await fetch(isFile ? `${ORIGIN}${url.pathname}` : `${ORIGIN}/`, { headers: { accept: request.headers.get("accept") || "*/*" }, cf: isFile ? { cacheTtl: 3600, cacheEverything: true } : { cacheTtl: 0 } });
    const headers = new Headers(upstream.headers);
    headers.set("x-frame-options", "DENY");
    headers.set("content-security-policy", "frame-ancestors 'none'");
    headers.set("referrer-policy", "no-referrer");
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set("x-content-type-options", "nosniff");
    headers.set("strict-transport-security", "max-age=31536000");
    if (isFile) return new Response(upstream.body, { status: upstream.status, headers });
    headers.set("cache-control", "no-store");
    // A page: drop the review site's link-preview tags and name it for signing.
    const page = new HTMLRewriter()
      .on('meta[property^="og:"], meta[name^="twitter:"]', { element(el) { el.remove(); } })
      .on("title", { element(el) { el.setInnerContent("Wrangler Sign"); } })
      .on("head", { element(el) { el.append('<meta name="robots" content="noindex, nofollow">', { html: true }); } })
      .transform(new Response(upstream.body, { status: 200, headers }));
    return page;
  },
};
