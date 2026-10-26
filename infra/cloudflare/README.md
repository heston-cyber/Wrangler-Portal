# Link previews — Cloudflare Worker (C8)

`og-worker.js` runs on `review.wranglerportal.com/s/*`. It serves the normal site page but with the right
Open Graph tags for that share link, so iMessage, WhatsApp, Slack and email show the video's picture and title.
The tags and picture come from the backend's `/og/s/<token>` (convex/og.ts). Nothing else about the site changes.

## Setup (once, ~5 minutes, in the Cloudflare dashboard)

1. **Proxy the record.** DNS → `wranglerportal.com` → the `review` CNAME (to `heston-cyber.github.io`): switch
   Proxy status from *DNS only* (grey cloud) to *Proxied* (orange cloud). Leave SSL/TLS mode on **Full** (not
   Flexible — GitHub serves HTTPS). The site keeps working exactly as before; Cloudflare now sits in front.
2. **Make the Worker.** Workers & Pages → Create → Worker → name it `wrangler-review-og` → Deploy the hello
   world → Edit code → replace everything with `og-worker.js` → Deploy.
3. **Route it.** Worker → Settings → Domains & Routes → Add → Route → `review.wranglerportal.com/s/*`,
   zone `wranglerportal.com` → Add.
4. **Check.** Paste a share link into iMessage or https://www.opengraph.xyz — the picture and title should show
   within a minute. (`curl -s https://review.wranglerportal.com/s/<token> | grep og:image` from a terminal also works.)

Free tier covers it (100k requests/day). If the Worker ever misbehaves, remove the route: links go back to plain.

## What a preview shows

- Anyone-with-the-link shares: the latest version's picture (first non-black frame + wordmark), the video title.
- Passcode or invited links: the title and the generic Wrangler card — never a frame, since a link can be
  forwarded before its passcode is.
- Off, expired, unknown: the generic card, no title.
