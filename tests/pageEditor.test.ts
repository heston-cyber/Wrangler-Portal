// @vitest-environment jsdom
// The page editor (E1–E3, Oct 27): one Craft-style editor where every line is a block.
//   T-E1 older documents convert to lines and containers without losing a word; text sizes (Ctrl+1–6, the Format tab,
//        the right-click menu) apply to every selected line at once; marks, alignment and colour batch too; the
//        checks that gate signing read the page.
//   T-E2 lines can be put in a container and taken out; Insert adds after the cursor, inside a container for lines and
//        after it for another container, and replaces an empty line.
//   T-E3 block selection: Esc selects the line, Shift+↓ adds blocks, Ctrl+4 changes them all and keeps them selected,
//        Esc again selects the container, Backspace deletes, Enter goes back to typing.
//   T-E4 phone select mode (Craft's circles): any blocks ticked, not just a run; sizes, colour, marks and lists change
//        exactly those; delete, duplicate and move work on them; the page can't be typed in meanwhile.
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextSelection } from "@tiptap/pm/state";
import { BlockSelect, headlessNodes } from "../src/builder/editor/schema";
import { BlockSelection, PickSelection, pickableBlocks } from "../src/builder/editor/blockSelection";
import {
  canMovePicked, currentSection, deletePicked, duplicatePicked, insertKind, isPicking, lineAttr, movePicked, picks, pickAll, setLines, setPickMode, toggleListPicked, unwrapSection, wrapInSection,
} from "../src/builder/editor/commands";
import { serviceAgreementBlocks, serviceAgreementPage } from "../convex/lib/wsStarter";
import {
  buildProblems, emptyFields, line, migrate, nodesOf, pageOf, section, sectionClause, clauseSection, signerKeys, textOf, totals,
  type Page, type PNode,
} from "../convex/lib/wsBuilder";

let editors: Editor[] = [];
afterEach(() => { for (const e of editors) e.destroy(); editors = []; });
function make(page: Page) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const e = new Editor({
    element: el,
    extensions: [StarterKit.configure({ paragraph: false, heading: false, codeBlock: false, blockquote: false, code: false, horizontalRule: false, link: false, undoRedo: false, trailingNode: false }), ...headlessNodes(), BlockSelect],
    content: page,
  });
  editors.push(e);
  return e as unknown as import("@tiptap/react").Editor;
}
/** The position just inside the n-th top-level line whose text starts with `start`. */
function posOf(e: { state: { doc: import("@tiptap/pm/model").Node } }, start: string): number {
  let at = -1;
  e.state.doc.descendants((n, pos) => { if (at < 0 && n.type.name === "paragraph" && n.textContent.startsWith(start)) at = pos + 1; return at < 0; });
  if (at < 0) throw new Error(`no line "${start}"`);
  return at;
}
const key = (e: { view: { dom: HTMLElement } }, k: string, mods: KeyboardEventInit = {}) => e.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods }));
const sizes = (e: { getJSON: () => unknown }, inside?: string) => {
  const out: string[] = [];
  const walk = (n: PNode) => { if (n.type === "paragraph") out.push(`${n.attrs?.size}:${textOf(n).slice(0, 12)}`); (n.content ?? []).forEach(walk); };
  const doc = e.getJSON() as PNode;
  const root = inside ? (doc.content ?? []).find((n) => n.type === "section" && textOf(n).includes(inside))! : doc;
  walk(root);
  return out;
};

describe("T-E1 the page model and batch formatting", () => {
  test("older documents convert without losing a word, initials or a setting", () => {
    const v1 = serviceAgreementBlocks();
    const page = migrate(v1);
    const allText = textOf(page as PNode);
    for (const b of v1) {
      if (b.type === "clause") { expect(allText).toContain(b.title); for (const p of b.rich.content) expect(allText).toContain(textOf(p).slice(0, 40)); }
      if (b.type === "heading") expect(allText).toContain(b.text);
    }
    const secs = nodesOf(page, "section");
    expect(secs.filter((s) => s.attrs?.initials).map((s) => textOf(s.content![0]))).toEqual(["Scope of work & deliverables", "Ownership & use", "Travel & expenses", "Data & revisions"]);
    expect(nodesOf(page, "payment")[0].attrs).toMatchObject({ depositPct: 25, invoiceDeposit: true, initials: true });
    expect(nodesOf(page, "signatures")[0].attrs).toMatchObject({ signers: ["heston", "client"], showTitle: true, showDate: true });
    expect(page.content[0]).toMatchObject({ type: "paragraph", attrs: { size: "title" } });
    expect(pageOf(v1)).toEqual(page);
    expect(pageOf(page)).toBe(page);
    expect(pageOf(undefined).content).toHaveLength(1);
    // The same checks as before gate signing.
    expect(signerKeys(page).sort()).toEqual(["client", "heston"]);
    const f = emptyFields(); f.client = { ...f.client, name: "A", email: "a@example.com" }; f.project = "P";
    expect(buildProblems({ title: "T", page, fields: f, signers: [], style: {} as never }).join(" ")).toMatch(/PICK ONE.*Data & revisions[\s\S]*line items/);
  });

  test("a library clause goes in as a container and comes back out the same", () => {
    const c = { _id: "c1", title: "Kill fee", body: { type: "doc" as const, content: [line("50% if cancelled.")] }, initials: true };
    const sec = clauseSection(c);
    expect(sec).toMatchObject({ type: "section", attrs: { initials: true, clauseId: "c1" } });
    expect(sectionClause(sec)).toEqual({ title: "Kill fee", body: { type: "doc", content: [{ type: "paragraph", attrs: { size: "body" }, content: [{ type: "text", text: "50% if cancelled." }] }] }, initials: true });
  });

  test("Ctrl+1–6 and the Format tab set the size of every selected line", () => {
    const e = make(serviceAgreementPage());
    const a = posOf(e, "This Service Agreement"), b = posOf(e, "Any changes to the scope");
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, a + 3, b + 3)));
    key(e, "6", { ctrlKey: true });
    const scope = sizes(e, "Scope of work");
    expect(scope.every((x) => x.startsWith("caption:"))).toBe(true); // the container's title too: it was selected
    expect(sizes(e)[3]).toBe("caption:This Service");
    expect(lineAttr(e, "size", "body")).toBe("caption");
    e.chain().setLineSize("heading").run();
    expect(sizes(e, "Scope of work").every((x) => x.startsWith("heading:"))).toBe(true);
    for (const [i, z] of ["title", "subtitle", "heading", "strong", "body", "caption"].entries()) {
      e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, a + 1)));
      key(e, String(i + 1), { ctrlKey: true });
      expect(sizes(e)[3]).toBe(`${z}:This Service`);
    }
  });

  test("alignment, colour and marks apply across the selection", () => {
    const e = make(serviceAgreementPage());
    const a = posOf(e, "Both parties agree"), b = posOf(e, "Total Project Budget");
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, a, b + 5)));
    setLines(e, { align: "center", color: "accent" });
    e.chain().toggleBold().run();
    const json = JSON.stringify(e.getJSON());
    const conf = (e.getJSON() as PNode).content!.find((n) => textOf(n).includes("Both parties agree"))!;
    expect(conf.content!.slice(1)[0].attrs).toMatchObject({ align: "center", color: "accent" });
    expect(json).toContain('"marks":[{"type":"bold"}]');
    expect(lineAttr(e, "align", "left")).toBe("center");
  });
});

describe("T-E2 containers and inserting", () => {
  test("lines go into a container and come back out", () => {
    const e = make({ type: "doc", content: [line("One"), line("Two"), line("Three")] });
    e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, posOf(e, "One"), posOf(e, "Two") + 1)));
    expect(wrapInSection(e, "card")).toBe(true);
    const doc = e.getJSON() as PNode;
    expect(doc.content![0]).toMatchObject({ type: "section", attrs: { look: "card" } });
    expect(doc.content![0].content!.map(textOf)).toEqual(["One", "Two"]);
    expect(currentSection(e)?.node.attrs.look).toBe("card");
    expect(wrapInSection(e, "plain")).toBe(false); // no containers inside containers
    expect(unwrapSection(e)).toBe(true);
    expect((e.getJSON() as PNode).content!.map(textOf)).toEqual(["One", "Two", "Three"]);
  });

  test("Insert adds after the cursor: lines inside a container, containers after it, an empty line is replaced", () => {
    const e = make({ type: "doc", content: [section([line("Clause", { size: "heading" }), line("Body")]), line("After"), line("")] });
    e.commands.setTextSelection(posOf(e, "Body") + 2);
    insertKind(e, "divider");
    expect((e.getJSON() as PNode).content![0].content!.map((n) => n.type)).toEqual(["paragraph", "paragraph", "divider"]);
    e.commands.setTextSelection(posOf(e, "Body") + 2);
    insertKind(e, "card");
    expect((e.getJSON() as PNode).content!.map((n) => n.type)).toEqual(["section", "section", "paragraph", "paragraph"]);
    // The empty last line becomes the signature block's heading and block.
    let last = 0; e.state.doc.forEach((_n, p) => { last = p; });
    e.commands.setTextSelection(last + 1);
    insertKind(e, "signatures");
    const types = (e.getJSON() as PNode).content!.map((n) => n.type);
    expect(types.slice(-2)).toEqual(["paragraph", "signatures"]);
    expect(types.filter((t) => t === "paragraph")).toHaveLength(2); // "After" and the new "Signatures" heading
    expect(totals(e.getJSON() as Page).total).toBe(0);
  });
});

describe("T-E3 block selection", () => {
  test("Esc, Shift+↓, Ctrl+4, Esc again, Enter, Backspace", () => {
    const e = make(serviceAgreementPage());
    e.commands.setTextSelection(posOf(e, "The COMPANY agrees to provide") + 2);
    key(e, "Escape");
    expect(e.state.selection).toBeInstanceOf(BlockSelection);
    key(e, "ArrowDown", { shiftKey: true }); key(e, "ArrowDown", { shiftKey: true });
    const sel = e.state.selection as BlockSelection;
    expect(sel.blocks().map((b) => b.node.textContent.slice(0, 10))).toEqual(["The COMPAN", "Deliverabl", "Timeline:"]);
    key(e, "4", { ctrlKey: true });
    expect(e.state.selection).toBeInstanceOf(BlockSelection); // still selected after the change
    expect(sizes(e, "Scope of work").slice(1, 5)).toEqual(["strong:The COMPANY ", "strong:Deliverable:", "strong:Timeline:", "body:Any changes "]);
    key(e, "ArrowUp"); // ↑ moves to the block above, alone
    expect((e.state.selection as BlockSelection).blocks().map((b) => b.node.textContent.slice(0, 10))).toEqual(["Deliverabl"]);
    key(e, "Escape"); // Esc again: the container
    const s2 = e.state.selection as BlockSelection;
    expect(s2.blocks()).toHaveLength(1);
    expect(s2.blocks()[0].node.type.name).toBe("section");
    key(e, "Enter"); // back to typing
    expect(e.state.selection).toBeInstanceOf(TextSelection);
    // Backspace removes selected blocks.
    e.commands.setTextSelection(posOf(e, "Deliverable:") + 1);
    key(e, "Escape"); key(e, "ArrowDown", { shiftKey: true });
    key(e, "Backspace");
    expect(sizes(e, "Scope of work").map((x) => x.split(":")[1])).toEqual(["Scope of wor", "The COMPANY ", "Any changes "]);
  });
});

describe("T-E4 phone select mode", () => {
  const page = (): Page => ({ type: "doc", content: [line("One"), line("Two"), line("Three"), section([line("In A", { size: "heading" }), line("In B")]), line("Four")] });
  const texts = (e: ReturnType<typeof make>) => { const out: string[] = []; e.state.doc.descendants((n) => { if (n.type.name === "paragraph") out.push(`${n.textContent}:${n.attrs.size}`); return true; }); return out; };

  test("ticks any blocks (lines inside containers too, not the containers); formatting changes exactly those", () => {
    const e = make(page());
    const all = pickableBlocks(e.state.doc);
    expect(all.map((p) => e.state.doc.nodeAt(p)!.textContent)).toEqual(["One", "Two", "Three", "In A", "In B", "Four"]);
    setPickMode(e, true, all[0]);
    expect(isPicking(e)).toBe(true);
    expect(e.isEditable).toBe(false);
    pickAll(e, [all[0], all[2], all[4]]);
    expect(e.state.selection).toBeInstanceOf(PickSelection);
    e.chain().setLineSize("caption").run();
    expect(texts(e)).toEqual(["One:caption", "Two:body", "Three:caption", "In A:heading", "In B:caption", "Four:body"]);
    setLines(e, { color: "accent", align: "center" });
    const colored: string[] = []; e.state.doc.descendants((n) => { if (n.type.name === "paragraph" && n.attrs.color === "accent") colored.push(n.textContent); return true; });
    expect(colored).toEqual(["One", "Three", "In B"]);
    e.chain().toggleBold().run();
    const bold: string[] = []; e.state.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === "bold")) bold.push(n.text!); return true; });
    expect(bold).toEqual(["One", "Three", "In B"]);
    expect(lineAttr(e, "size", "body")).toBe("caption");
    // Still ticked after all that.
    expect(picks(e).map((p) => e.state.doc.nodeAt(p)!.textContent)).toEqual(["One", "Three", "In B"]);
  });

  test("lists, duplicate, move and delete act on the ticked blocks only; done goes back to typing", () => {
    const e = make(page());
    const all = pickableBlocks(e.state.doc);
    setPickMode(e, true);
    pickAll(e, [all[0], all[2]]);
    toggleListPicked(e, "bulletList");
    expect(e.state.doc.child(0).type.name).toBe("bulletList");
    expect(e.state.doc.child(1).type.name).toBe("paragraph");
    expect(e.state.doc.child(2).type.name).toBe("bulletList");
    expect(picks(e)).toHaveLength(2);
    expect(canMovePicked(e)).toBe(false); // not next to each other
    duplicatePicked(e);
    expect(e.state.doc.childCount).toBe(7);
    expect(picks(e).map((p) => e.state.doc.nodeAt(p)!.textContent)).toEqual(["One", "Three"]); // the copies
    expect(deletePicked(e)).toBe(2);
    expect(e.state.doc.childCount).toBe(5);
    const now = pickableBlocks(e.state.doc);
    pickAll(e, [now[1], now[2]]); // Two, Three: together
    expect(canMovePicked(e)).toBe(true);
    movePicked(e, -1);
    expect([0, 1, 2].map((i) => e.state.doc.child(i).textContent)).toEqual(["Two", "Three", "One"]);
    expect(movePicked(e, -1)).toBe(false); // already at the top
    setPickMode(e, false);
    expect(isPicking(e)).toBe(false);
    expect(e.isEditable).toBe(true);
    expect(e.state.selection).toBeInstanceOf(TextSelection);
  });
});
