// The preview's password page (infra/cloudflare-preview): locked without a password, a wrong one is refused, a right
// one sets the cookie and only same-site paths are followed after it.
import { describe, expect, test } from "vitest";
// @ts-expect-error plain JS Worker
import worker from "../infra/cloudflare-preview/preview-worker.js";

const env = { PREVIEW_PASSWORD: "correct horse battery", ASSETS: { fetch: async () => new Response("<html>app</html>", { headers: { "content-type": "text/html" } }) } };
const post = (password: string, next: string) => { const f = new FormData(); f.set("password", password); f.set("next", next); return new Request("https://preview.wranglerportal.com/__preview", { method: "POST", body: f }); };

describe("preview Worker", () => {
  test("locked with no password set; asks without the cookie", async () => {
    expect((await worker.fetch(new Request("https://p/"), {})).status).toBe(503);
    expect((await worker.fetch(new Request("https://p/inbox"), env)).status).toBe(401);
  });
  test("a wrong password is refused; a right one lets you in, and never redirects off the site", async () => {
    expect((await worker.fetch(post("nope", "/inbox"), env)).status).toBe(401);
    const ok = await worker.fetch(post("correct horse battery", "//evil.example"), env);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/");
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    const page = await worker.fetch(new Request("https://p/inbox", { headers: { cookie } }), env);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await worker.fetch(post("correct horse battery", "/docs?tab=signed"), env)).headers.get("location")).toBe("/docs?tab=signed");
  });
  test("emails' logo images load without the cookie; nothing else does", async () => {
    expect((await worker.fetch(new Request("https://p/brand/wp-logo-email.png"), env)).status).toBe(200);
    expect((await worker.fetch(new Request("https://p/brand/x.html"), env)).status).toBe(401);
    expect((await worker.fetch(new Request("https://p/brand/../index.html"), env)).status).toBe(401);
    expect((await worker.fetch(new Request("https://p/brand/wp-logo-email.png", { method: "POST" }), env)).status).toBe(401);
  });
}, 10_000);
