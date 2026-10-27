// @vitest-environment node
// B4 (Oct 27): the builder through Claude's connector, and PDFs made editable.
//   T-B4.1 page markdown reads and writes every kind of line and block, and the starter survives a round trip.
//   T-B4.2 a PDF's text comes back as a title, headings with their text in sections, joined-up paragraphs, lists and
//          a signature block, without page numbers; scanned (text-less) PDFs are refused with advice.
//   T-B4.3 Claude makes a draft from the Service Agreement with the client, project, line items and deposit filled in,
//          sees its problems, fixes them with markdown, and takes it to signing (rendered on the backend): a document
//          with the boxes, signers and deposit, and still only approved/sent on Heston's OK.
//   T-B4.4 import_pdf turns a PDF into a draft through the connector.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { pageFromMarkdown, pageToMarkdown } from "../convex/lib/wsPageMd";
import { pdfLinesToPage } from "../convex/lib/wsPdfImport";
import { serviceAgreementPage } from "../convex/lib/wsStarter";
import { nodesOf, textOf, type PNode } from "../convex/lib/wsBuilder";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.RESEND_API_KEY = "re_test"; process.env.SITE_URL = "https://review.wranglerportal.com"; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const stripIds = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/"id":"k\w+"/g, '"id":"x"'));

/** A two-page contract, the way a word processor would make it. */
async function contractPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const reg = await d.embedFont(StandardFonts.Helvetica), bold = await d.embedFont(StandardFonts.HelveticaBold);
  const p1 = d.addPage([612, 792]), p2 = d.addPage([612, 792]);
  let y = 720;
  const put = (pg: typeof p1, t: string, size = 10, font = reg, x = 72) => { pg.drawText(t, { x, y, size, font }); y -= size * 1.45; };
  put(p1, "Video Production Agreement", 22, bold); y -= 8;
  put(p1, "Prepared for Harbor Coffee", 14); y -= 10;
  put(p1, "1. Scope of Work", 11, bold);
  put(p1, "The Company will produce one brand film of up to two minutes, including pre-production, a one day");
  put(p1, "shoot in Oklahoma City, editing, colour and sound, delivered as a 4K master and social cutdowns.");
  put(p1, "Deliverables:");
  put(p1, "• One 2:00 brand film");
  put(p1, "• Three 0:15 social cutdowns");
  y -= 6;
  put(p1, "Client initials: {{initials:client}}");
  y -= 8;
  put(p1, "2. Payment", 11, bold);
  put(p1, "A 25% deposit is due on signing and the balance on delivery.");
  p1.drawText("Page 1 of 2", { x: 280, y: 40, size: 8, font: reg });
  y = 720;
  put(p2, "3. Ownership", 11, bold);
  put(p2, "The Client owns the final film on full payment. The Company may show it in its portfolio.");
  y -= 30;
  put(p2, "Client: {{sign:client}}   Date: {{date:client}}");
  put(p2, "Wrangler: {{sign:heston}}   Date: {{date:heston}}");
  p2.drawText("Page 2 of 2", { x: 280, y: 40, size: 8, font: reg });
  return d.save();
}
const b64 = (u: Uint8Array) => { let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s); };

async function setup() {
  const t = convexTest(schema, modules);
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: "e" }), { status: 200 });
    return new Response("{}", { status: 500 }); // no Google fonts here: the PDF falls back to Helvetica
  });
  const sub = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
    return `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
  });
  const me = t.withIdentity({ subject: sub });
  const store = (b: Uint8Array) => t.run((ctx) => ctx.storage.store(new Blob([b], { type: "image/png" })));
  await me.action(api.sign.adoptSignature, { name: "Heston Hill", title: "Founder", method: "typed", signatureStorageId: await store(PNG), initialsStorageId: await store(PNG) });
  await me.mutation(api.builder.ensureStarter, {});
  const { key } = await me.action(api.wsConnector.createKey, {});
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await t.fetch("/ws-mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    const j = JSON.parse(await r.text());
    return { error: j.result.isError === true, text: j.result.content[0].text as string, data: j.result.structuredContent as Record<string, any> };
  };
  return { t, me, call };
}

describe("T-B4.1 page markdown", () => {
  test("every kind of line and block", () => {
    const md = [
      "# Brand Film Agreement", "## For {client.company}", "### Scope", "#### Strong line", "~ Fine print",
      "Body with **bold**, *italic*, __underline__ and ~~strike~~. {: align=center color=accent deco=focus font=heading}", "\\",
      "- one", "  - one.a", "- two", "1. first", "2. second",
      ":::section initials", "### Payment terms", "The deposit is due on signing.", "[[payment deposit=30 invoice=no initials=yes]]", ":::",
      ":::card", "A note", ":::",
      "[[parties]]", "[[items]]", "| Description | Qty | Rate |", "| Shoot day | 2 | 1800 |", "| Edit | 1 | 2400 |",
      "[[signatures heston client client2 title=no date=yes]]", "[[divider]]", "[[pagebreak]]", "[[space 24]]",
    ].join("\n");
    const page = pageFromMarkdown(md);
    const types = page.content.map((n) => n.type === "paragraph" ? `p:${n.attrs!.size}` : n.type);
    expect(types).toEqual(["p:title", "p:subtitle", "p:heading", "p:strong", "p:caption", "p:body", "p:body", "bulletList", "orderedList", "section", "section", "parties", "items", "signatures", "divider", "pagebreak", "spacer"]);
    const body = page.content[5];
    expect(body.attrs).toMatchObject({ align: "center", color: "accent", deco: "focus", font: "heading" });
    expect(body.content!.map((n) => `${(n.marks ?? []).map((m) => m.type).join("+") || "-"}:${n.text}`)).toEqual(["-:Body with ", "bold:bold", "-:, ", "italic:italic", "-:, ", "underline:underline", "-: and ", "strike:strike", "-:."]);
    expect(page.content[6].content).toBeUndefined(); // "\" is an empty line
    expect(page.content[7].content![0].content!.length).toBe(2); // "one" has its nested list
    const sec = page.content[9];
    expect(sec.attrs).toMatchObject({ initials: true, look: "plain" });
    expect(sec.content!.map((n) => n.type)).toEqual(["paragraph", "paragraph", "payment"]);
    expect(sec.content![2].attrs).toEqual({ depositPct: 30, invoiceDeposit: false, initials: true });
    expect(page.content[10].attrs!.look).toBe("card");
    expect((page.content[12].attrs!.rows as any[]).map((r) => `${r.description}/${r.qty}/${r.rate}`)).toEqual(["Shoot day/2/1800", "Edit/1/2400"]);
    expect(page.content[13].attrs).toEqual({ signers: ["heston", "client", "client2"], showTitle: false, showDate: true });
    expect(page.content[16].attrs).toEqual({ size: 24 });
    // And back again, unchanged.
    expect(stripIds(pageFromMarkdown(pageToMarkdown(page)))).toEqual(stripIds(page));
  });

  test("the Service Agreement survives a round trip", () => {
    const page = serviceAgreementPage();
    const md = pageToMarkdown(page);
    expect(md).toContain(":::section initials\n### Scope of work & deliverables");
    expect(md).toContain("[[payment deposit=25 invoice=yes initials=yes]]");
    expect(stripIds(pageFromMarkdown(md))).toEqual(stripIds(page));
  });
});

describe("T-B4.2 a PDF made editable", () => {
  test("titles, sections, paragraphs, lists and the signature block come back; page numbers don't", async () => {
    const { t } = await setup();
    const sid = await t.run(async (ctx) => ctx.storage.store(new Blob([await contractPdf()], { type: "application/pdf" })));
    const lines = await t.action(internal.wsNode.extractLines, { storageId: sid });
    expect(lines.find((l) => l.text === "1. Scope of Work")?.bold).toBe(true);
    const { page, notes, stats } = pdfLinesToPage(lines);
    const top = page.content;
    expect(top[0]).toMatchObject({ type: "paragraph", attrs: { size: "title" } });
    expect(textOf(top[0])).toBe("Video Production Agreement");
    expect(top[1].attrs?.size).toBe("subtitle");
    const secs = nodesOf(page, "section");
    expect(secs.map((s) => textOf(s.content![0]))).toEqual(["1. Scope of Work", "2. Payment", "3. Ownership"]);
    expect(secs[0].attrs?.initials).toBe(true); // the {{initials:client}} line
    expect(secs[1].attrs?.initials).toBe(false);
    // The wrapped sentence is one paragraph again, and the bullets are a list.
    const scope = secs[0].content!;
    expect(textOf(scope[1])).toBe("The Company will produce one brand film of up to two minutes, including pre-production, a one day shoot in Oklahoma City, editing, colour and sound, delivered as a 4K master and social cutdowns.");
    const list = scope.find((n) => n.type === "bulletList")!;
    expect(list.content!.map(textOf)).toEqual(["One 2:00 brand film", "Three 0:15 social cutdowns"]);
    expect(JSON.stringify(page)).not.toMatch(/Page \d of 2|\{\{/);
    expect(nodesOf(page, "signatures")[0].attrs?.signers).toEqual(["heston", "client"]);
    expect(stats).toMatchObject({ pages: 2, sections: 3 });
    expect(notes.join(" ")).toMatch(/signature block/);
  });

  test("a PDF with no text is refused with advice", async () => {
    const { t, me } = await setup();
    const d = await PDFDocument.create(); d.addPage([612, 792]);
    const sid = await t.run(async (ctx) => ctx.storage.store(new Blob([await d.save()], { type: "application/pdf" })));
    await expect(me.action(api.builder.importPdf, { storageId: sid })).rejects.toThrow(/no text.*create_draft/);
  });
});

describe("T-B4.3 a contract made with the builder through the connector", () => {
  test("from the template, filled in, fixed, and to signing; approval still needs Heston", async () => {
    const x = await setup();
    const tl = await x.call("list_templates");
    expect(tl.error, tl.text).toBe(false);
    expect(tl.data.items.map((t: any) => t.name)).toEqual(["Service Agreement"]);
    const c = await x.call("create_draft", {
      template: "service agreement", title: "Service Agreement — Harbor Coffee",
      client: { name: "Maya Chen", email: "Maya@HarborCoffee.example", company: "Harbor Coffee" }, project: "Brand Film", date: "2026-11-02",
      line_items: [{ description: "Brand film (2:00) and three cutdowns", qty: 1, rate: 6400 }], deposit_percent: 30,
    });
    expect(c.error, c.text).toBe(false);
    expect(c.data).toMatchObject({ title: "Service Agreement — Harbor Coffee", project: "Brand Film", totals: { total: 6400, deposit_percent: 30, deposit: 1920, stripe_draft_on_completion: true }, initialled_sections: 4 });
    expect(c.data.client.email).toBe("maya@harborcoffee.example");
    expect(c.data.problems.join(" ")).toMatch(/PICK ONE/);
    expect(c.data.link).toMatch(/\/sign\/b\//);
    // Not ready: draft_to_signing refuses with the problems.
    const early = await x.call("draft_to_signing", { draft: c.data.draft_id });
    expect(early.error).toBe(true); expect(early.text).toMatch(/PICK ONE/);
    // Claude fixes the markdown: keep the two-rounds clause.
    const md = (c.data.markdown as string).split("\n").filter((l) => !/^PICK ONE:|One round of revisions/.test(l)).join("\n");
    const u = await x.call("update_draft", { draft: "harbor coffee", markdown: md });
    expect(u.error, u.text).toBe(false);
    expect(u.data.problems).toEqual([]);
    expect(u.data.totals.total).toBe(6400); // the line items came through the markdown
    // To signing: rendered on the backend; boxes from the signature block and the initialled sections.
    const s = await x.call("draft_to_signing", { draft: c.data.draft_id });
    expect(s.error, s.text).toBe(false);
    expect(s.data).toMatchObject({ document: "WS-00001", status: "draft", heston_signs: true, payment: { amount: 1920 }, problems: [], rebuilt: false });
    expect(s.data.signers).toEqual([{ key: "client", name: "Maya Chen", email: "maya@harborcoffee.example", title: null, order: 1 }]);
    expect(s.data.boxes.filter((b: any) => b.kind === "initials")).toHaveLength(5); // 4 sections + the payment block
    expect(s.data.boxes.filter((b: any) => b.kind === "sign").map((b: any) => b.signer).sort()).toEqual(["client", "heston"]);
    // The draft knows its document; a change and draft_to_signing again rebuilds the same document.
    const g = await x.call("get_draft", { draft: c.data.draft_id });
    expect(g.data.document).toMatchObject({ document: "WS-00001", status: "draft" });
    await x.call("update_draft", { draft: c.data.draft_id, deposit_percent: 50 });
    const again = await x.call("draft_to_signing", { draft: c.data.draft_id });
    expect(again.data).toMatchObject({ document: "WS-00001", rebuilt: true, payment: { amount: 3200 } });
    // Approval still needs Heston's words.
    const r0 = await x.call("approve_document", { document: "WS-00001" });
    expect(r0.error).toBe(true);
    // Save as a template keeps no client.
    const st = await x.call("save_draft_as_template", { draft: c.data.draft_id, name: "Brand film agreement" });
    expect(st.error, st.text).toBe(false);
    const tpl = await x.call("get_template", { template: "brand film" });
    expect(tpl.data.markdown).not.toContain("Maya");
    expect((await x.call("list_drafts", { query: "harbor" })).data.items).toHaveLength(1);
  }, 60_000);

  test("a draft from Claude's own markdown", async () => {
    const x = await setup();
    const c = await x.call("create_draft", { markdown: "# Change Order 1\n:::section initials\n### Extra shoot day\nOne more day in Tulsa.\n:::\n[[items]]\n| Shoot day | 1 | 1800 |\n[[signatures heston client]]", client: { name: "A B", email: "a@b.example" } });
    expect(c.error, c.text).toBe(false);
    expect(c.data).toMatchObject({ title: "Change Order 1", problems: [], totals: { total: 1800 } });
  });
});

describe("T-B4.4 import_pdf through the connector", () => {
  test("a PDF becomes a draft with the markdown to check", async () => {
    const x = await setup();
    const r = await x.call("import_pdf", { pdf_base64: b64(await contractPdf()) });
    expect(r.error, r.text).toBe(false);
    expect(r.data.title).toBe("Video Production Agreement");
    expect(r.data.markdown).toContain(":::section initials\n### 1. Scope of Work");
    expect(r.data.markdown).toContain("- One 2:00 brand film");
    expect(r.data.markdown).toContain("[[signatures heston client");
    expect(r.data.problems.join(" ")).toMatch(/client's name/);
    // An existing document can be copied in too, and its file stays.
    const d = await x.call("create_document", { title: "Old agreement", pdf_base64: b64(await contractPdf()), signers: [{ name: "A B", email: "a@b.example" }] });
    const r2 = await x.call("import_pdf", { document: d.data.document });
    expect(r2.error, r2.text).toBe(false);
    expect((await x.call("preview_document", { document: d.data.document })).error).toBe(false);
  }, 60_000);
});
