// Phase 0.5b (Oct 28): every link sent on review.wranglerportal.com forwards to the same place on app.
import { expect, test } from "vitest";
// @ts-expect-error plain JS Worker module
import { target } from "../infra/cloudflare-redirects/redirect-worker.js";

test("review. links keep their path and query, permanently", () => {
  const cases = [
    "/s/AbCdEfGh12345678", "/s/AbCdEfGh12345678/v/k57abc123def456ghi789jkl?version=2&note=xyz", "/v/k57abc?version=3",
    "/x/0123456789abcdef0123", "/sign/d/k57doc", "/settings?tab=clients#dropbox", "/", "/lab/frametest",
  ];
  for (const p of cases) {
    const u = new URL(p, "https://review.wranglerportal.com");
    expect(target(u.href)).toEqual({ location: `https://app.wranglerportal.com${u.pathname}${u.search}`, status: 301 });
  }
});

test("the bare domain and www go to the app's front page, temporarily", () => {
  for (const h of ["https://wranglerportal.com/lander", "https://www.wranglerportal.com/", "https://wranglerportal.com/?x=1"]) {
    expect(target(h)).toEqual({ location: "https://app.wranglerportal.com/", status: 302 });
  }
});
