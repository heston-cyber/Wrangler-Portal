// Phase 6 security sweep M1 (Nov 17): shared files open through a signed link that lasts 10-20 minutes.
//   FL1 a genuine link opens the file (a PDF in place, anything else as a download)
//   FL2 an expired, altered or other deployment's link opens nothing
//   FL3 (review) an SVG shows in place, sandboxed; a name of only dots still opens
//   FL4 (review M1) a W-9 is never "this business's file": not a style's logo, not a link anywhere
import { describe, expect, test } from "vitest";
import { checkFileLink, fileLink, LINK_WINDOW_MS } from "../convex/lib/fileLinks";
import { anyApi } from "convex/server";
import { world } from "./payHarness";

const api = anyApi;

const path = (u: string) => new URL(u, "https://x.convex.site").pathname;

describe("signed file links", () => {
  test("FL1 a genuine link opens the file; a PDF in place, anything else downloads", async () => {
    const w = await world();
    const pdf = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 hi"], { type: "application/pdf" })));
    const page = await w.t.run((ctx) => ctx.storage.store(new Blob(["<b>hi</b>"], { type: "text/html" })));
    const r = await w.t.fetch(path((await fileLink(pdf, "Contract.pdf"))!));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("%PDF-1.4 hi");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const h = await w.t.fetch(path((await fileLink(page, "page.html"))!));
    expect(h.headers.get("content-type")).not.toMatch(/html/);
    expect(h.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  test("FL2 an expired, altered or other deployment's link opens nothing", async () => {
    const w = await world();
    const id = await w.t.run((ctx) => ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })));
    const old = path((await fileLink(id, "a.pdf", Date.now() - 3 * LINK_WINDOW_MS))!);
    expect(await checkFileLink(old)).toBeNull();
    expect((await w.t.fetch(old)).status).toBe(404);
    const good = path((await fileLink(id, "a.pdf"))!);
    expect(await checkFileLink(good)).toMatchObject({ fileId: id, name: "a.pdf" });
    const parts = good.split("/"); // ["", "fl", id, exp, sig, name]
    const otherName = [...parts.slice(0, 5), "b.pdf"].join("/");
    const later = [...parts.slice(0, 3), String(Number(parts[3]) + LINK_WINDOW_MS), ...parts.slice(4)].join("/");
    const flipped = [...parts.slice(0, 4), parts[4].replace(/^./, (c) => (c === "A" ? "B" : "A")), parts[5]].join("/");
    for (const p of [otherName, later, flipped]) expect(await checkFileLink(p), p).toBeNull();
    const saved = process.env.FILE_LINK_SECRET;
    process.env.FILE_LINK_SECRET = "another-deployment";
    expect(await checkFileLink(good)).toBeNull();
    process.env.FILE_LINK_SECRET = saved;
  });

  test("FL3 an SVG shows in place, sandboxed; a name of only dots still opens", async () => {
    const w = await world();
    const svg = await w.t.run((ctx) => ctx.storage.store(new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], { type: "image/svg+xml" })));
    const r = await w.t.fetch(path((await fileLink(svg, "logo.svg"))!));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/svg+xml");
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox/);
    const dots = await fileLink(svg, "..");
    expect(dots).toMatch(/\/file$/);
    expect((await w.t.fetch(path(dots!))).status).toBe(200);
    const saved = process.env.CONVEX_SITE_URL;
    const here = path((await fileLink(svg, "logo.svg"))!);
    process.env.CONVEX_SITE_URL = "https://another.convex.site"; // another deployment's link
    expect(await checkFileLink(here)).toBeNull();
    if (saved === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = saved;
  });

  test("FL4 a W-9 is never this business's file: not a style's logo", async () => {
    const w = await world();
    const w9 = await w.t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(["%PDF w9"], { type: "application/pdf" }));
      await ctx.db.insert("fileOwners", { storageId: id, businessId: w.A, purpose: "w9", at: 0 });
      return id;
    });
    await expect(w.heston.mutation(api.builder.saveStyle, { name: "Sneaky", style: { logo: { fileId: w9, width: 120, align: "left" } } })).rejects.toThrow(/isn't one of yours/);
  });
});
