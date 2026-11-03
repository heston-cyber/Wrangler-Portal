// Phase 5c (Nov 3): Site watch's page check. Loads the pages anyone can open (sign-in and the no-account links, with
// made-up tokens so they show their "not found" state) on desktop (1440) and phone (390), and reports page errors,
// console errors, failed requests and sideways scrolling. Signed-in pages need a test login, which doesn't exist yet.
//
//   node scripts/site-watch-pages.mjs [base]        base defaults to https://preview.wranglerportal.com
//
// Prints one JSON line per problem ({ key, title, detail }) for `npx convex run siteWatch:agentFound`, then a summary
// line. Exits 1 when anything is wrong, 2 when the preview is locked (no PREVIEW_PASSWORD). It never signs in, submits a form or clicks a button.
import { createRequire } from "node:module";
// Playwright isn't one of the portal's packages: the cloud sessions have it installed globally (require finds it).
const { chromium } = createRequire(import.meta.url)("playwright");

const base = (process.argv[2] || "https://preview.wranglerportal.com").replace(/\/$/, "");
const fake = "sitewatchnotarealtoken0000";
const pages = ["/", `/s/${fake}`, `/i/${fake}`, `/q/${fake}`, `/p/${fake}`, `/sub/${fake}`, `/x/${fake}`, `/words/${fake}`];
const sizes = [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }];
// Noise that isn't the portal's problem.
const IGNORE = [/favicon/i, /ResizeObserver loop/i, /Download the React DevTools/i];

// The preview sits behind a password page (infra/cloudflare-preview): its cookie is an HMAC of the password. The
// password comes only from the environment (PREVIEW_PASSWORD, set by Heston in the environment's settings), never chat.
const host = new URL(base).hostname;
const cookies = [];
if (process.env.PREVIEW_PASSWORD && host.startsWith("preview.")) {
  const { createHmac } = await import("node:crypto");
  const value = createHmac("sha256", process.env.PREVIEW_PASSWORD).update("wrangler-preview-v1").digest("hex");
  cookies.push({ name: "wp_preview", value, domain: host, path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
}

const browser = await chromium.launch();
const problems = [];
try {
  // Locked preview and no password: one clear problem, not one per page.
  if (!cookies.length && host.startsWith("preview.")) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const res = await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    const locked = !!res && (res.status() === 401 || res.status() === 503) && /^Preview ·/.test(await page.title());
    await ctx.close();
    if (locked) {
      console.log(JSON.stringify({ key: "page:preview-locked", title: "The preview's pages couldn't be checked: it's locked", detail: "Set PREVIEW_PASSWORD in the site-watch environment's settings (not in chat), or check the live site instead." }));
      console.log(JSON.stringify({ summary: true, base, checked: 0, problems: 1, locked: true }));
      await browser.close();
      process.exit(2);
    }
  }
  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
    if (cookies.length) await ctx.addCookies(cookies);
    for (const path of pages) {
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(`page error: ${e.message}`));
      // "Failed to load resource" lines are judged by the response itself below (they carry no address).
      page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errs.push(`console: ${m.text()}`); });
      page.on("requestfailed", (r) => errs.push(`request failed: ${new URL(r.url()).pathname} (${r.failure()?.errorText ?? "?"})`));
      // The live site is served from GitHub, which answers a deep link (/q/…, /p/…) with a 404 status while serving the
      // app (infra/cloudflare/og-worker.js): the page itself is judged by whether it renders. Any other file or API
      // call answering 4xx or 5xx is a problem.
      page.on("response", (r) => {
        const isDoc = r.request().resourceType() === "document" && r.request().frame() === page.mainFrame();
        if (r.status() >= 500 || (!isDoc && r.status() >= 400)) errs.push(`HTTP ${r.status()}: ${new URL(r.url()).pathname}`);
      });
      let status = 0;
      try {
        status = (await page.goto(base + path, { waitUntil: "networkidle", timeout: 30_000 }))?.status() ?? 0;
        await page.waitForTimeout(1500);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (wide > 1) errs.push(`scrolls sideways by ${wide}px`);
        const blank = await page.evaluate(() => (document.body.innerText || "").trim().length < 5);
        if (blank) errs.push("the page is blank");
      } catch (e) {
        errs.push(`didn't load: ${String(e.message).split("\n")[0]}`);
      }
      if (status >= 500) errs.push(`HTTP ${status}`);
      const real = [...new Set(errs)].filter((e) => !IGNORE.some((r) => r.test(e)));
      const shown = path.replace(fake, "<token>");
      if (real.length) problems.push({ key: `page:${shown.replace(/[^A-Za-z0-9_.:/-]/g, "")}:${size.name}`, title: `${shown} has problems on ${size.name}`, detail: real.slice(0, 5).join(" · ").slice(0, 600) });
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const p of problems) console.log(JSON.stringify(p));
console.log(JSON.stringify({ summary: true, base, checked: pages.length * sizes.length, problems: problems.length }));
process.exit(problems.length ? 1 : 0);
