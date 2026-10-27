// @vitest-environment node
// Wrangler Sign doc builder (B1–B3, Oct 27).
//   T-B1 Contracts › Docs: filter by status, words and date; sort by each column both ways; the address round-trips.
//   T-B2 a built document renders to a PDF whose invisible markers become boxes on the right lines (signatures, names,
//        titles, dates, initials), with the fields filled in; "Continue to signing" makes a document with the signers
//        and the deposit, rebuilds its draft in place, and refuses once it's out for signature.
//   T-B3 templates and clauses: the Service Agreement starter is added once; save, use, duplicate, delete; a template
//        never keeps a client's details; deleting a template leaves documents made from it alone; styles and the default.
import { convexTest } from "convex-test";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { DocPdf } from "../src/builder/pdf";
import { serviceAgreementBlocks } from "../convex/lib/wsStarter";
import { DEFAULT_STYLE, PRESET_STYLES, buildProblems, emptyFields, plainText, rich, type Block, type BuildDoc } from "../convex/lib/wsBuilder";
import { scanMarkers } from "../convex/lib/wsMarkers";
import { DEFAULT_QUERY, countByStatus, filterDocs, readQuery, writeQuery, type DocRow } from "../src/sign/docFilter";

const modules = import.meta.glob("../convex/**/*.ts");
beforeAll(() => { process.env.ALLOWED_EMAILS = "heston@wranglerproductions.com"; process.env.RESEND_API_KEY = "re_test"; process.env.SITE_URL = "https://review.wranglerportal.com"; });
afterEach(() => vi.unstubAllGlobals());
const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

// ---------- T-B1 ----------
describe("T-B1 the Docs list", () => {
  const day = 86_400_000, now = Date.UTC(2026, 9, 27);
  const row = (n: number, status: DocRow["status"], title: string, client: string, ago: number): DocRow => ({
    _id: `d${n}`, label: `WS-${String(n).padStart(5, "0")}`, number: n, title, status, signers: client ? [client] : [], emails: client ? [`${client.split(" ")[0].toLowerCase()}@example.com`] : [],
    createdAt: now - ago * day - 1000, updatedAt: now - ago * day, sentAt: null, completedAt: null,
  });
  const docs = [row(1, "completed", "UTT Flagship", "Dillon Ripley", 40), row(2, "sent", "Change order", "Ann Lee", 3), row(3, "draft", "Brand film", "Zed Moss", 1), row(4, "voided", "Old one", "", 200)];

  test("status tabs and counts", () => {
    expect(filterDocs(docs, { ...DEFAULT_QUERY, status: "sent" }, now).map((d) => d.number)).toEqual([2]);
    expect(countByStatus(docs)).toEqual({ all: 4, draft: 1, approved: 0, sent: 1, completed: 1, voided: 1 });
  });
  test("search matches number, title, client and email, every word", () => {
    expect(filterDocs(docs, { ...DEFAULT_QUERY, q: "ripley" }, now).map((d) => d.number)).toEqual([1]);
    expect(filterDocs(docs, { ...DEFAULT_QUERY, q: "WS-00003" }, now).map((d) => d.number)).toEqual([3]);
    expect(filterDocs(docs, { ...DEFAULT_QUERY, q: "ann@example" }, now).map((d) => d.number)).toEqual([2]);
    expect(filterDocs(docs, { ...DEFAULT_QUERY, q: "brand moss" }, now).map((d) => d.number)).toEqual([3]);
    expect(filterDocs(docs, { ...DEFAULT_QUERY, q: "brand ripley" }, now)).toEqual([]);
  });
  test("date range", () => {
    expect(filterDocs(docs, { ...DEFAULT_QUERY, range: "7d" }, now).map((d) => d.number)).toEqual([3, 2]);
    expect(filterDocs(docs, { ...DEFAULT_QUERY, range: "90d" }, now).map((d) => d.number)).toEqual([3, 2, 1]);
  });
  test("sorts both ways", () => {
    const by = (sort: any, dir: any) => filterDocs(docs, { ...DEFAULT_QUERY, sort, dir }, now).map((d) => d.number);
    expect(by("updated", "desc")).toEqual([3, 2, 1, 4]);
    expect(by("number", "asc")).toEqual([1, 2, 3, 4]);
    expect(by("title", "asc")).toEqual([3, 2, 4, 1]);
    expect(by("client", "asc")).toEqual([4, 2, 1, 3]);
    expect(by("created", "desc")).toEqual([3, 2, 1, 4]);
  });
  test("the address round-trips and ignores junk", () => {
    const q = { status: "completed" as const, q: "utt", sort: "title" as const, dir: "asc" as const, range: "30d" as const };
    expect(readQuery(writeQuery(q))).toEqual(q);
    expect(writeQuery(DEFAULT_QUERY)).toBe("");
    expect(readQuery("?status=bogus&sort=nope&dir=up&range=forever")).toEqual(DEFAULT_QUERY);
  });
});

// ---------- shared: a filled-in Service Agreement ----------
function agreement(): BuildDoc {
  const f = emptyFields(undefined, new Date(Date.UTC(2026, 9, 27, 12)));
  f.client = { name: "Dillon Ripley", company: "United Turf and Track, Inc", email: "dillon@example.com", phone: "", address: "Arcadia, OK" };
  f.project = "UTT Flagship Film";
  const blocks = serviceAgreementBlocks().map((b): Block => {
    if (b.type === "items") return { ...b, rows: b.rows.map((r, i) => (i === 0 ? { ...r, rate: 4800 } : r)) };
    if (b.type === "clause" && /PICK ONE:/.test(plainText(b.rich))) return { ...b, rich: rich("Two rounds of revisions are included.") };
    return b;
  });
  return { title: "Service Agreement — UTT", blocks, fields: f, signers: [], style: DEFAULT_STYLE };
}
const render = async (d: BuildDoc) => new Uint8Array(await renderToBuffer(<DocPdf d={d} assets={{ fonts: [], files: {} }} label="WS-00009" />));

// ---------- T-B2 ----------
describe("T-B2 rendering and Continue to signing", () => {
  test("the starter as written can't go to signing until the revisions clause is picked", () => {
    const d = agreement();
    expect(buildProblems(d)).toEqual([]);
    const raw = { ...d, blocks: serviceAgreementBlocks() };
    expect(buildProblems(raw).join(" ")).toMatch(/PICK ONE/);
    expect(buildProblems({ ...d, fields: { ...d.fields, client: { ...d.fields.client, email: "nope" } } }).join(" ")).toMatch(/client's email/);
  });

  test("markers land on the lines, fields are filled, and nothing shows in braces", async () => {
    const bytes = await render(agreement());
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
    const r = await scanMarkers(doc, pdfjs);
    const got = r.markers.map((m: any) => `${m.kind}:${m.signer}`).sort();
    // Initials on Scope, Payment, Ownership, Travel and Data & revisions; both parties sign, print name, title and date.
    expect(got.filter((k: string) => k === "initials:client")).toHaveLength(5);
    for (const k of ["sign:client", "sign:heston", "name:client", "name:heston", "date:client", "date:heston"]) expect(got).toContain(k);
    for (const m of r.markers as any[]) {
      expect(m.box.x).toBeGreaterThanOrEqual(0); expect(m.box.y).toBeGreaterThanOrEqual(0);
      expect(m.box.x + m.box.w).toBeLessThanOrEqual(1); expect(m.box.y + m.box.h).toBeLessThanOrEqual(1);
      expect(m.box.page).toBeGreaterThanOrEqual(0); expect(m.box.page).toBeLessThan(r.pages); // pages count from 0 inside
    }
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) text += (await (await doc.getPage(p)).getTextContent()).items.map((i: any) => i.str).join(" ") + "\n";
    expect(text).toContain("Dillon Ripley");
    expect(text).toContain("UTT Flagship Film");
    expect(text).toContain("$4,800.00");
    expect(text).not.toMatch(/(?<!\{)\{(client|project|business|deposit|total|balance|date)[a-z.]*\}(?!\})/);
    expect(text).not.toContain("PICK ONE");
  }, 60_000);

  test("every preset renders", async () => {
    for (const style of PRESET_STYLES) {
      const bytes = await render({ ...agreement(), style });
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    }
  }, 120_000);

  test("Continue to signing: makes the document, rebuilds the draft, refuses once it's sent", async () => {
    const t = convexTest(schema, modules);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "e" }), { status: 200 }));
    const sub = await t.run(async (ctx) => {
      const owner = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
      return `${owner}|${await ctx.db.insert("authSessions", { userId: owner, expirationTime: Date.now() + 3_600_000 })}`;
    });
    const me = t.withIdentity({ subject: sub });
    const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const png = () => t.run((ctx) => ctx.storage.store(new Blob([PNG], { type: "image/png" })));
    await me.action(api.sign.adoptSignature, { name: "Heston Hill", title: "Founder", method: "typed", signatureStorageId: await png(), initialsStorageId: await png() });
    const d = agreement();
    const buildId = await me.mutation(api.builder.createBuild, {});
    await me.mutation(api.builder.saveBuild, { buildId, title: d.title, blocks: d.blocks, fields: d.fields, signers: [], style: d.style });
    const put = async () => { const b = await render(d); return t.run((ctx) => ctx.storage.store(new Blob([b], { type: "application/pdf" }))); };

    const first = await me.action(api.builder.toSigning, { buildId, storageId: await put() });
    expect(first.rebuilt).toBe(false);
    const got: any = (await me.query(api.sign.get, { documentId: first.documentId }))!.version;
    expect(got.signers.map((s: any) => s.key).sort()).toEqual(["client", "heston"]);
    expect(got.signers.find((s: any) => s.key === "client")).toMatchObject({ name: "Dillon Ripley", email: "dillon@example.com" });
    expect(got.boxes.filter((b: any) => b.kind === "initials")).toHaveLength(5);
    expect(got.payment.amountCents).toBe(120000); // 25% of $4,800
    const full: any = await me.query(api.sign.get, { documentId: first.documentId });
    expect(full.problems).toEqual([]); // ready to approve
    const linked = await me.query(api.builder.getBuild, { buildId });
    expect(linked!.document?._id).toBe(first.documentId);

    const again = await me.action(api.builder.toSigning, { buildId, storageId: await put() });
    expect(again).toMatchObject({ documentId: first.documentId, rebuilt: true });
    const list: any[] = await me.query(api.sign.list, {});
    expect(list).toHaveLength(1);

    await t.run(async (ctx) => ctx.db.patch(first.documentId, { status: "sent" }));
    await expect(me.action(api.builder.toSigning, { buildId, storageId: await put() })).rejects.toThrow(/out for signature/);
    await expect(me.mutation(api.builder.deleteBuild, { buildId })).rejects.toThrow(/gone to signing/);
  }, 120_000);
});

// ---------- T-B3 ----------
describe("T-B3 templates, clauses and styles", () => {
  async function owner() {
    const t = convexTest(schema, modules);
    const sub = await t.run(async (ctx) => {
      const o = await ctx.db.insert("users", { email: "heston@wranglerproductions.com", name: "Heston", role: "owner" });
      return `${o}|${await ctx.db.insert("authSessions", { userId: o, expirationTime: Date.now() + 3_600_000 })}`;
    });
    return { t, me: t.withIdentity({ subject: sub }) };
  }

  test("the starter is added once, with its clauses, and doesn't come back after it's deleted", async () => {
    const { me } = await owner();
    expect(await me.mutation(api.builder.ensureStarter, {})).toEqual({ added: true });
    expect(await me.mutation(api.builder.ensureStarter, {})).toEqual({ added: false });
    const ts = await me.query(api.builder.listTemplates, {});
    expect(ts.map((x) => x.name)).toEqual(["Service Agreement"]);
    const clauses = await me.query(api.builder.listClauses, {});
    expect(clauses.length).toBeGreaterThan(5);
    expect(clauses.filter((c) => c.initials).length).toBeGreaterThanOrEqual(4);
    await me.mutation(api.builder.deleteTemplate, { templateId: ts[0]._id });
    expect(await me.mutation(api.builder.ensureStarter, {})).toEqual({ added: false });
    expect(await me.query(api.builder.listTemplates, {})).toEqual([]);
  });

  test("save as template keeps no client details; use, duplicate and delete", async () => {
    const { me } = await owner();
    const d = agreement();
    d.fields.custom = [{ key: "shoot.days", label: "Shoot days", value: "3" }];
    const templateId = await me.mutation(api.builder.saveAsTemplate, { name: "UTT style", title: d.title, blocks: d.blocks, fields: d.fields, signers: [], style: d.style });
    const tpl: any = await me.query(api.builder.getTemplate, { templateId });
    expect(JSON.stringify(tpl.fields)).not.toContain("Dillon");
    expect(tpl.fields.custom).toEqual([{ key: "shoot.days", label: "Shoot days", value: "" }]);

    const buildId = await me.mutation(api.builder.createBuild, { templateId });
    const b: any = await me.query(api.builder.getBuild, { buildId });
    expect(b.title).toBe("UTT style");
    expect(b.blocks).toHaveLength(d.blocks.length);
    expect(b.blocks[0].id).not.toBe(d.blocks[0].id); // fresh ids
    expect(b.fields.client.name).toBe("");
    expect(b.templateId).toBe(templateId);

    const copy = await me.mutation(api.builder.duplicateTemplate, { templateId });
    expect((await me.query(api.builder.listTemplates, {})).map((x) => x.name).sort()).toEqual(["UTT style", "UTT style (copy)"]);
    await me.mutation(api.builder.updateTemplate, { templateId: copy, name: "Renamed", blocks: [], fields: tpl.fields, style: tpl.style });
    await me.mutation(api.builder.deleteTemplate, { templateId });
    expect((await me.query(api.builder.getBuild, { buildId }))!.blocks).toHaveLength(d.blocks.length); // the document keeps its copy
    expect((await me.query(api.builder.listTemplates, {})).map((x) => x.name)).toEqual(["Renamed"]);
    await expect(me.mutation(api.builder.createBuild, { templateId })).rejects.toThrow(/doesn't exist/);
  });

  test("clauses: save, edit, duplicate, delete", async () => {
    const { me } = await owner();
    const id = await me.mutation(api.builder.saveClause, { title: "Kill fee", body: rich("50% if cancelled."), initials: true });
    await me.mutation(api.builder.saveClause, { clauseId: id, title: "Kill fee", body: rich("60% if cancelled."), initials: false });
    const dup = await me.mutation(api.builder.duplicateClause, { clauseId: id });
    let all = await me.query(api.builder.listClauses, {});
    expect(all.map((c) => c.title)).toEqual(["Kill fee", "Kill fee (copy)"]);
    expect(plainText(all[0].body as any)).toContain("60%");
    expect(all[0].initials).toBe(false);
    await me.mutation(api.builder.deleteClause, { clauseId: dup });
    all = await me.query(api.builder.listClauses, {});
    expect(all).toHaveLength(1);
    await expect(me.mutation(api.builder.saveClause, { title: "  ", body: rich(""), initials: false })).rejects.toThrow(/title/);
  });

  test("Google fonts are fetched as TTF (what PDFs embed), once", async () => {
    const { t, me } = await owner();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      if (url.startsWith("https://fonts.googleapis.com/")) {
        const ua = new Headers(init?.headers).get("user-agent") ?? "";
        const ext = /Mozilla/.test(ua) ? "woff" : "ttf"; // what Google does
        const face = (w: number, i: boolean) => `@font-face { font-family: 'Lora'; font-style: ${i ? "italic" : "normal"}; font-weight: ${w}; src: url(https://fonts.gstatic.com/s/lora/x${w}${i ? "i" : ""}.${ext}) format('truetype'); }`;
        return new Response([face(400, false), face(700, false), face(400, true), face(700, true)].join("\n"));
      }
      if (url.startsWith("https://fonts.gstatic.com/")) return new Response(new Uint8Array([0, 1, 0, 0, 1, 2, 3]));
      return new Response("{}", { status: 500 });
    });
    expect(await me.action(api.builder.ensureGoogleFont, { family: "Lora" })).toEqual({ added: 4 });
    expect(await me.action(api.builder.ensureGoogleFont, { family: "Lora" })).toEqual({ added: 0 });
    const fonts = await me.query(api.builder.listFonts, {});
    expect(fonts.map((f) => `${f.weight}${f.italic ? "i" : ""}`).sort()).toEqual(["400", "400i", "700", "700i"]);
    expect(asked.filter((u) => u.includes("gstatic")).every((u) => u.endsWith(".ttf"))).toBe(true);
    await expect(me.action(api.builder.ensureGoogleFont, { family: "Bad<script>" })).rejects.toThrow(/doesn't look right/);
    void t;
  });

  test("styles: the default is what new documents start with", async () => {
    const { me } = await owner();
    const night = PRESET_STYLES.find((s) => s.name === "Night")!;
    const plain = await me.mutation(api.builder.createBuild, {});
    expect(((await me.query(api.builder.getBuild, { buildId: plain }))!.style as any).name).toBe(PRESET_STYLES[0].name);
    const styleId = await me.mutation(api.builder.saveStyle, { name: "My night", style: { ...night, name: "My night" } });
    await me.mutation(api.builder.setDefaultStyle, { styleId });
    const b = await me.mutation(api.builder.createBuild, {});
    expect(((await me.query(api.builder.getBuild, { buildId: b }))!.style as any).name).toBe("My night");
    await me.mutation(api.builder.setDefaultStyle, { preset: 1 });
    const c = await me.mutation(api.builder.createBuild, {});
    expect(((await me.query(api.builder.getBuild, { buildId: c }))!.style as any).name).toBe(PRESET_STYLES[1].name);
  });
});
