// Production smoke test (C5, Oct 24). Opens the live site in a real browser the way a guest would and fails if any
// page shows the error screen, throws in the page, or the clip doesn't load through its signed link.
//
//   SMOKE=$(npx convex run smoke:run) node tests/smoke/smoke.mjs
//
// SMOKE is the JSON `smoke:run` prints: { site, tokens: { comment, view, pass, off, expired }, passcode, clipStatus }.
// Set SMOKE_HEADED=1 to watch it. Uses Google Chrome (channel "chrome") so H.264 plays; falls back to Chromium.
import { chromium } from "playwright";

const cfg = JSON.parse(process.env.SMOKE || "{}");
if (!cfg.tokens) { console.error("SMOKE env is missing (run smoke:run first)"); process.exit(2); }
const site = (cfg.site || "https://review.wranglerportal.com").replace(/\/$/, "");
const T = cfg.tokens;
const failures = [];
const passed = [];

const browser = await (async () => {
  try { return await chromium.launch({ channel: "chrome", headless: !process.env.SMOKE_HEADED }); }
  catch { return await chromium.launch({ headless: !process.env.SMOKE_HEADED }); }
})();
let h264Noted = false;

async function check(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" || /favicon|net::ERR_/.test(m.text())) return;
    // GitHub Pages answers a deep link with 404.html (the site itself) and a 404 status: that one is expected.
    if (/404/.test(m.text()) && m.location()?.url === page.url()) return;
    errors.push(`console: ${m.text().slice(0, 160)}`);
  });
  try {
    await fn(page);
    if (await page.getByText("Something broke on this page.").count()) throw new Error("the error screen is showing");
    if (errors.length) throw new Error(errors.join(" | "));
    passed.push(name);
    console.log(`ok   ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.log(`FAIL ${name}: ${e.message}`);
    try { await page.screenshot({ path: `smoke-${name.replace(/\W+/g, "-")}.png` }); } catch { /* no screenshot */ }
  } finally {
    await ctx.close();
  }
}

const see = (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 20_000 });

// The clip is a "file" version: the player asks for the MP4 through a signed link. 200/206 means the token works.
async function clipLoads(page) {
  const res = await page.waitForResponse((r) => /\.mp4(\?|$)/.test(r.url()) && r.request().resourceType() !== "fetch", { timeout: 30_000 });
  if (![200, 206].includes(res.status())) throw new Error(`clip answered ${res.status()}`);
  const h264 = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"'));
  if (!h264) { if (!h264Noted) { h264Noted = true; console.log("note: this browser can't decode H.264, so the clip's duration isn't checked (its signed link answered)"); } return; }
  await page.waitForFunction(() => { const v = document.querySelector("video"); return !!v && v.readyState >= 1 && v.duration > 0; }, null, { timeout: 30_000 })
    .catch(() => { throw new Error("video never reported a duration (codec or signed link)"); });
}

await check("home asks a stranger to sign in", async (page) => {
  await page.goto(`${site}/`);
  await page.locator("input#email").waitFor({ timeout: 20_000 });
});

await check("a made-up link says it goes nowhere", async (page) => {
  await page.goto(`${site}/s/notarealtoken0000`);
  await see(page, "This link doesn't go anywhere.");
});

await check("a switched-off link says so", async (page) => {
  await page.goto(`${site}/s/${T.off}`);
  await see(page, "This link has been switched off.");
});

await check("an expired link says so", async (page) => {
  await page.goto(`${site}/s/${T.expired}`);
  await see(page, "This link has expired.");
});

await check("a passcode link: wrong passcode refused, right one opens the video", async (page) => {
  await page.goto(`${site}/s/${T.pass}`);
  await see(page, "This link has a passcode.");
  await page.getByLabel("Passcode").fill("wrong-one");
  await page.getByRole("button", { name: "Open" }).click();
  await see(page, "That one didn't match.");
  await page.getByLabel("Passcode").fill(cfg.passcode);
  await page.getByRole("button", { name: "Open" }).click();
  await page.locator("video").first().waitFor({ timeout: 20_000 });
  await see(page, "What's your name?");
});

await check("a comment link: video page, name prompt, then the note box", async (page) => {
  await page.goto(`${site}/s/${T.comment}`);
  await page.locator("video").first().waitFor({ timeout: 20_000 });
  await clipLoads(page);
  await see(page, "What's your name?");
  await page.getByLabel("Your name").fill("Smoke Test");
  await page.getByLabel("Save name").click();
  await page.getByRole("textbox", { name: "Note" }).waitFor({ timeout: 10_000 }); // the composer opens by default once there's a name
  if (await page.getByText("What's your name?").count()) throw new Error("the name prompt stayed");
  // Reload: the name is remembered on this device, so the note box is straight back.
  await page.reload();
  await page.getByRole("textbox", { name: "Note" }).waitFor({ timeout: 20_000 });
});

await check("a view-only link: player only, no note box, no name prompt", async (page) => {
  await page.goto(`${site}/s/${T.view}`);
  await page.locator("video").first().waitFor({ timeout: 20_000 });
  await clipLoads(page);
  await see(page, "View only");
  if (await page.getByText("What's your name?").count()) throw new Error("a view link asked for a name");
  if (await page.getByRole("textbox", { name: "Note" }).count()) throw new Error("a view link showed the note box");
});

await browser.close();
console.log(`\n${passed.length} passed, ${failures.length} failed`);
if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exit(1); }
