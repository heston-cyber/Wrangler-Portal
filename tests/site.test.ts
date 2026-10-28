// Phase 0.5b (Oct 28): the backend names its own address in one place only (convex/lib/site.ts, from SITE_URL),
// so moving review.wranglerportal.com → app.wranglerportal.com is one setting.
import { afterEach, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LAB_CLIP, SITE, SITE_HOST, SITE_SLASH } from "../convex/lib/site";

const saved = process.env.SITE_URL;
afterEach(() => { if (saved === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = saved; });

test("SITE follows the SITE_URL setting and trims trailing slashes", () => {
  process.env.SITE_URL = "https://app.wranglerportal.com//";
  expect(SITE()).toBe("https://app.wranglerportal.com");
  expect(SITE_SLASH()).toBe("https://app.wranglerportal.com/");
  expect(SITE_HOST()).toBe("app.wranglerportal.com");
  expect(LAB_CLIP()).toBe("https://app.wranglerportal.com/lab/frametest_23976_h264.mp4");
  delete process.env.SITE_URL;
  expect(SITE()).toBe("https://review.wranglerportal.com");
});

test("no backend code names the review host except lib/site.ts (comments aside)", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (n === "_generated") continue; if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p); } };
  walk("convex");
  const hits = files.filter((p) => !p.endsWith(join("lib", "site.ts"))).flatMap((p) =>
    readFileSync(p, "utf8").split("\n").map((l, i) => ({ p, i: i + 1, l }))
      .filter(({ l }) => /review\.wranglerportal\.com/.test(l.replace(/(^|\s)\/\/.*$/, ""))));
  expect(hits.map((h) => `${h.p}:${h.i}`)).toEqual([]);
});
