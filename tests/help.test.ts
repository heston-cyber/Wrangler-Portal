// Phase 5d step 4 (T5d.6): Help. Wrangler's twelve starter guides; each side reads only its own; the owner's edit (kept
// as a "guide" template) is what that business's people read, and Reset brings Wrangler's back; search reads the text;
// another business's edit never shows; guides stay out of Docs' template lists.
import { beforeAll, describe, expect, test } from "vitest";
import { anyApi } from "convex/server";
import { setup } from "./matrix";
import { GUIDES, guidePage } from "../convex/lib/helpGuides";
import { textOf } from "../convex/lib/wsBuilder";

const api = anyApi;
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; });

async function who() {
  const { t, ids } = await setup();
  return { t, ids, owner: t.withIdentity({ subject: ids.ownerSub }), client: t.withIdentity({ subject: ids.clientSub }), vendor: t.withIdentity({ subject: ids.vendorSub }) };
}
const slugs = (rows: Array<{ slug: string }>) => rows.map((r) => r.slug).sort();

describe("help", () => {
  test("There are twelve starter guides; the owner reads all of them, a client the client ones, a vendor the vendor ones", async () => {
    const { owner, client, vendor, ids } = await who();
    expect(GUIDES).toHaveLength(12);
    expect(slugs(await owner.query(api.help.list, {}))).toEqual(GUIDES.map((g) => g.slug).sort());
    const c = slugs(await client.query(api.help.list, {}));
    expect(c).toEqual(GUIDES.filter((g) => g.audience !== "vendor").map((g) => g.slug).sort());
    const vd = slugs(await vendor.query(api.help.list, { businessId: ids.businessId }));
    expect(vd).toEqual(GUIDES.filter((g) => g.audience !== "client").map((g) => g.slug).sort());
    expect(c).toContain("signing-in"); expect(vd).toContain("signing-in");
    expect(c).not.toContain("adding-a-w9"); expect(vd).not.toContain("paying-an-invoice");
  });

  test("A guide reads as a page; one for the other side isn't handed over", async () => {
    const { client, vendor, owner, ids } = await who();
    const g = await client.query(api.help.guide, { slug: "paying-an-invoice" });
    expect(g).toMatchObject({ slug: "paying-an-invoice", title: "Paying an invoice", edited: false, mine: false });
    expect(textOf({ type: "doc", content: g.page.content } as never)).toContain("receipt");
    expect(await client.query(api.help.guide, { slug: "adding-a-w9" })).toBeNull();
    expect(await vendor.query(api.help.guide, { slug: "paying-an-invoice", businessId: ids.businessId })).toBeNull();
    expect(await vendor.query(api.help.guide, { slug: "adding-a-w9", businessId: ids.businessId })).not.toBeNull();
    expect(await owner.query(api.help.guide, { slug: "nope" })).toBeNull();
  });

  test("Search reads the text of the guides, not only their titles", async () => {
    const { client } = await who();
    expect(slugs(await client.query(api.help.list, { q: "six-digit code" }))).toContain("signing-in");
    expect(await client.query(api.help.list, { q: "zzzqqq" })).toEqual([]);
    expect(slugs(await client.query(api.help.list, { q: "INVOICE" }))).toContain("paying-an-invoice");
  });

  test("The owner's edit is what clients read; the Edited chip shows to the owner only; Reset brings Wrangler's back", async () => {
    const { owner, client, t } = await who();
    const id = await owner.mutation(api.help.edit, { slug: "paying-an-invoice" });
    expect(await owner.mutation(api.help.edit, { slug: "paying-an-invoice" })).toBe(id); // opening it again is the same copy
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ kind: "guide", guideSlug: "paying-an-invoice", name: "Paying an invoice" });
    const page = { type: "doc", content: [{ type: "paragraph", attrs: { size: "title" }, content: [{ type: "text", text: "How to pay us" }] }, { type: "paragraph", attrs: { size: "body" }, content: [{ type: "text", text: "Call the office." }] }, { type: "signatures", attrs: {} }] };
    await owner.mutation(api.builder.updateTemplate, { templateId: id, name: "How to pay us", description: "Our way.", blocks: page, fields: { project: "", custom: [] }, style: row!.style });
    const seen = await client.query(api.help.guide, { slug: "paying-an-invoice" });
    expect(seen).toMatchObject({ title: "How to pay us", edited: false });
    expect(textOf({ type: "doc", content: seen.page.content } as never)).toContain("Call the office.");
    expect(seen.page.content.map((n: { type: string }) => n.type)).toEqual(["paragraph", "paragraph"]); // the signature block is left out
    expect((await client.query(api.help.list, {})).find((g: { slug: string }) => g.slug === "paying-an-invoice")).toMatchObject({ title: "How to pay us", summary: "Our way.", edited: false });
    expect((await owner.query(api.help.list, {})).find((g: { slug: string }) => g.slug === "paying-an-invoice")).toMatchObject({ edited: true });
    expect(await owner.query(api.help.guide, { slug: "paying-an-invoice" })).toMatchObject({ edited: true, mine: true });
    await owner.mutation(api.help.reset, { slug: "paying-an-invoice" });
    expect(await client.query(api.help.guide, { slug: "paying-an-invoice" })).toMatchObject({ title: "Paying an invoice", edited: false });
    expect((await owner.query(api.help.list, {})).find((g: { slug: string }) => g.slug === "paying-an-invoice")).toMatchObject({ edited: false });
    await owner.mutation(api.help.reset, { slug: "paying-an-invoice" }); // again: nothing to do
  });

  test("Guides never show in Docs' template lists, and another business's edit is never read", async () => {
    const { owner, client, t } = await who();
    await owner.mutation(api.help.edit, { slug: "your-files" });
    expect((await owner.query(api.builder.listTemplates, {})).map((x: { name: string }) => x.name)).not.toContain("Finding your files");
    const other = await t.run(async (ctx) => ctx.db.insert("businesses", { slug: "other", name: "Other Co", createdAt: 0 }));
    await t.run(async (ctx) => { await ctx.db.insert("wsTemplates", { businessId: other, name: "Other's version", kind: "guide", guideSlug: "signing-in", blocks: guidePage(GUIDES[0]), fields: {}, style: {}, createdAt: 0, updatedAt: 0 }); });
    expect(await client.query(api.help.guide, { slug: "signing-in" })).toMatchObject({ title: "Signing in" });
  });

  test("A stranger and a signed-out visitor read nothing, and nobody but the owner edits", async () => {
    const { t, ids, client, vendor } = await who();
    for (const as of [t, t.withIdentity({ subject: ids.strangerSub })]) {
      await expect(as.query(api.help.list, {})).rejects.toThrow(/Sign in|Not allowed/);
      await expect(as.query(api.help.guide, { slug: "signing-in" })).rejects.toThrow(/Sign in|Not allowed/);
    }
    for (const as of [t, client, vendor]) {
      await expect(as.mutation(api.help.edit, { slug: "signing-in" })).rejects.toThrow(/Sign in|Not allowed/);
      await expect(as.mutation(api.help.reset, { slug: "signing-in" })).rejects.toThrow(/Sign in|Not allowed/);
    }
  });
});
