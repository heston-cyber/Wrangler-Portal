// Wrangler Review — link previews (C8, Oct 26).
// Runs on review.wranglerportal.com/s/* in Cloudflare. For a share link it fetches the normal page from GitHub Pages,
// asks the backend for that link's preview (title, picture), and writes those tags into <head> before handing the
// page on — to iMessage, WhatsApp, Slack and ordinary browsers alike. Everything else passes straight through.
// If the backend doesn't answer, the plain page is served. GitHub answers deep links with a 404 status (it serves
// 404.html as the app); chat apps skip previews on a 404, so share pages go out as 200.
const BACKEND = "https://handsome-hummingbird-11.convex.site";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const m = /^\/s\/([A-Za-z0-9_-]{8,64})(?:\/v\/([a-z0-9]{20,40}))?\/?$/.exec(url.pathname);
    const origin = await fetch(request);
    if (!m || request.method !== "GET") return origin;
    const type = origin.headers.get("content-type") || "";
    if (!type.includes("text/html")) return origin;

    let data = null;
    try {
      const q = m[2] ? `?v=${m[2]}` : "";
      const r = await fetch(`${BACKEND}/og/s/${m[1]}${q}`, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (r.ok) data = await r.json();
    } catch (e) { /* backend quiet: plain page */ }

    const headers = new Headers(origin.headers);
    headers.set("cache-control", "public, max-age=60");
    if (!data) return new Response(origin.body, { status: 200, headers });

    const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const tags = [
      `<meta property="og:site_name" content="${esc(data.siteName)}">`,
      `<meta property="og:type" content="video.other">`,
      `<meta property="og:title" content="${esc(data.title)}">`,
      `<meta property="og:description" content="${esc(data.description)}">`,
      `<meta property="og:url" content="${esc(data.url)}">`,
      `<meta property="og:image" content="${esc(data.image)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${esc(data.title)}">`,
      `<meta name="twitter:description" content="${esc(data.description)}">`,
      `<meta name="twitter:image" content="${esc(data.image)}">`,
    ].join("\n    ");

    const rewritten = new HTMLRewriter()
      .on('meta[property^="og:"], meta[name^="twitter:"]', { element(el) { el.remove(); } })
      .on("title", { element(el) { el.setInnerContent(`${data.title} · ${data.siteName}`); } })
      .on("head", { element(el) { el.append(tags, { html: true }); } })
      .transform(origin);
    return new Response(rewritten.body, { status: 200, headers });
  },
};
