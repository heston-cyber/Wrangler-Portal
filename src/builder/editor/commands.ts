// What the Format tab, the right-click menu and the Insert tab do to the page (E1–E2, Oct 27). Everything acts on the
// lines in the selection (a text selection across lines, a block selection, or just the line with the cursor), so a
// batch of lines changes together.
import type { Editor } from "@tiptap/react";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { dropPoint } from "@tiptap/pm/transform";
import { isAtom, newNodes, sectionClause, type InsertKind, type LineAttrs, type PNode, type TextSize } from "../../../convex/lib/wsBuilder";
import { BlockSelection, PickSelection, blockRange, blockStartAt, pickActive, pickKey, pickStartAt } from "./blockSelection";

/** The lines (paragraphs) in the selection. */
export function selectedLines(editor: Editor): PMNode[] {
  const { state } = editor;
  const out: PMNode[] = [];
  const sel = state.selection;
  if (sel.empty) { const p = sel.$from.parent; return p.type.name === "paragraph" ? [p] : []; }
  for (const r of sel.ranges) state.doc.nodesBetween(r.$from.pos, r.$to.pos, (n) => { if (n.type.name === "paragraph") out.push(n); });
  return out;
}

/** The common value of a line attribute across the selection ("" when lines differ). */
export function lineAttr<K extends keyof LineAttrs>(editor: Editor, k: K, def: LineAttrs[K]): LineAttrs[K] | "" {
  const lines = selectedLines(editor);
  if (!lines.length) return "";
  const vals = new Set(lines.map((l) => (l.attrs[k] ?? def) as LineAttrs[K]));
  return vals.size === 1 ? [...vals][0] : "";
}

export const setLines = (editor: Editor, attrs: LineAttrs) => editor.chain().focus().updateAttributes("paragraph", attrs).run();
export const setSize = (editor: Editor, size: TextSize) => editor.chain().focus().setLineSize(size).run();
export const toggleDeco = (editor: Editor, deco: "focus" | "block") => setLines(editor, { deco: lineAttr(editor, "deco", null) === deco ? null : deco });
export const clearFormatting = (editor: Editor) => editor.chain().focus().unsetAllMarks().updateAttributes("paragraph", { align: null, color: null, deco: null, font: null }).run();

/** The container (section) the selection is in, with its position. */
export function currentSection(editor: Editor): { node: PMNode; pos: number } | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "section") return { node: $from.node(d), pos: $from.before(d) };
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === "section") return { node: sel.node, pos: sel.from };
  if (sel instanceof BlockSelection) { const b = sel.blocks(); if (b.length === 1 && b[0].node.type.name === "section") return b[0]; }
  return null;
}
export function setSection(editor: Editor, attrs: Record<string, unknown>) {
  const s = currentSection(editor);
  if (!s) return false;
  return editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(s.pos, undefined, { ...s.node.attrs, ...attrs }); return true; }).run();
}
/** Put the selected lines in a container (Craft's "Turn into card"). */
export function wrapInSection(editor: Editor, look: "plain" | "card") {
  if (currentSection(editor)) return false;
  return editor.chain().focus().wrapIn("section", { look, initials: false, clauseId: null }).run();
}
/** Take the lines out of their container. */
export function unwrapSection(editor: Editor) {
  const s = currentSection(editor);
  if (!s) return false;
  return editor.chain().focus().command(({ tr }) => {
    tr.replaceWith(s.pos, s.pos + s.node.nodeSize, s.node.content);
    return true;
  }).run();
}
export const sectionAsClause = (s: PMNode) => sectionClause(s.toJSON() as PNode);

/** The atom selected on its own (to show its settings), if any. */
export function selectedAtom(editor: Editor): { node: PMNode; pos: number } | null {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && isAtom(sel.node.type.name)) return { node: sel.node, pos: sel.from };
  return null;
}
export function setAtom(editor: Editor, pos: number, attrs: Record<string, unknown>) {
  const n = editor.state.doc.nodeAt(pos);
  if (!n) return false;
  return editor.chain().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...attrs }); return true; }).run();
}

/** Where a click in the Insert tab adds things: after the block with the cursor (inside its container). */
function insertPoint(editor: Editor, nodes: PNode[]): { from: number; to: number } {
  const { state } = editor;
  const sel = state.selection;
  const hasSection = nodes.some((n) => n.type === "section");
  if (sel instanceof NodeSelection || sel instanceof BlockSelection) {
    if (hasSection) { const $t = state.doc.resolve(sel.to); return { from: $t.depth ? $t.after(1) : sel.to, to: $t.depth ? $t.after(1) : sel.to }; }
    return { from: sel.to, to: sel.to };
  }
  const $f = sel.$from;
  for (let d = $f.depth; d >= 1; d--) {
    const parent = $f.node(d - 1).type.name;
    if (parent === "doc" || (parent === "section" && !hasSection)) {
      const blk = $f.node(d);
      // An empty line is replaced by what's inserted.
      if (blk.type.name === "paragraph" && !blk.content.size && sel.empty) return { from: $f.before(d), to: $f.after(d) };
      return { from: $f.after(d), to: $f.after(d) };
    }
  }
  return { from: state.doc.content.size, to: state.doc.content.size };
}

/** Add nodes (an Insert item or a library clause) after the cursor, and put the cursor in the first line added. */
export function insertNodes(editor: Editor, nodes: PNode[]) {
  const { from, to } = insertPoint(editor, nodes);
  editor.chain().focus().insertContentAt({ from, to }, nodes).run();
  const after = editor.state.doc.resolve(Math.min(from + 1, editor.state.doc.content.size));
  editor.chain().setTextSelection(TextSelection.near(after).from).scrollIntoView().run();
}
export const insertKind = (editor: Editor, kind: InsertKind) => insertNodes(editor, newNodes(kind));

/** Drop dragged Insert items or clauses at the pointer (a valid spot nearby, inside containers too). */
export function dropNodes(editor: Editor, nodes: PNode[], coords: { left: number; top: number }, opts: { focus?: boolean } = {}): boolean {
  const { view, state } = editor;
  const at = view.posAtCoords(coords);
  if (!at) return false;
  const frag = Fragment.fromArray(nodes.map((n) => state.schema.nodeFromJSON(n)));
  const slice = new Slice(frag, 0, 0);
  const pos = dropPoint(state.doc, at.pos, slice) ?? at.pos;
  const tr = state.tr.insert(pos, frag);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
  view.dispatch(opts.focus === false ? tr : tr.scrollIntoView());
  if (opts.focus !== false) view.focus(); // a phone drop doesn't bring the keyboard up
  return true;
}
/** Where a drop at these coordinates would land, as a line to draw (screen coordinates), for the phone drag. */
export function dropLineAt(editor: Editor, nodes: PNode[], coords: { left: number; top: number }): { top: number; left: number; width: number } | null {
  const { view, state } = editor;
  const at = view.posAtCoords(coords);
  if (!at) return null;
  let slice: Slice;
  try { slice = new Slice(Fragment.fromArray(nodes.map((n) => state.schema.nodeFromJSON(n))), 0, 0); } catch { return null; }
  const pos = dropPoint(state.doc, at.pos, slice) ?? at.pos;
  const $p = state.doc.resolve(pos);
  // The line goes between the block before and the one after, across the container the drop lands in.
  const before = $p.nodeBefore ? view.nodeDOM(pos - $p.nodeBefore.nodeSize) as HTMLElement | null : null;
  const after = $p.nodeAfter ? view.nodeDOM(pos) as HTMLElement | null : null;
  const box = (after ?? before)?.getBoundingClientRect?.();
  if (!box) { const c = view.coordsAtPos(pos); const r = (view.dom as HTMLElement).getBoundingClientRect(); return { top: c.top, left: r.left, width: r.width }; }
  const top = after ? (before ? (before.getBoundingClientRect().bottom + box.top) / 2 : box.top - 2) : box.bottom + 2;
  return { top, left: box.left, width: box.width };
}

/** Outline entries: titles, subtitles and headings, and containers (by their first line), with where they are. */
export type OutlineItem = { pos: number; text: string; level: 0 | 1 };
export function outline(doc: PMNode, values: Record<string, string>, fillFn: (s: string, v: Record<string, string>) => string): OutlineItem[] {
  const out: OutlineItem[] = [];
  doc.forEach((n, pos) => {
    const name = n.type.name;
    if (name === "paragraph" && ["title", "subtitle", "heading"].includes(n.attrs.size) && n.textContent.trim()) out.push({ pos, text: fillFn(n.textContent, values), level: n.attrs.size === "heading" ? 1 : 0 });
    else if (name === "section") out.push({ pos, text: fillFn(n.firstChild?.textContent || "Section", values), level: 0 });
  });
  return out;
}

/** The block (a line, a container or a special block) the cursor is in, or the selected blocks. */
function currentBlocks(editor: Editor): { from: number; to: number } | null {
  const sel = editor.state.selection;
  if (sel instanceof BlockSelection) return { from: sel.from, to: sel.to };
  const start = blockStartAt(editor.state.doc, sel.from, sel instanceof NodeSelection ? sel.from : -1);
  if (start === null) return null;
  const n = editor.state.doc.nodeAt(start);
  return n ? { from: start, to: start + n.nodeSize } : null;
}
/** Move the current block(s) up or down past one neighbour (phones can't drag; the Format tab has these). */
export function moveBlock(editor: Editor, dir: -1 | 1, opts: { scroll?: boolean } = {}): boolean {
  const r = currentBlocks(editor);
  if (!r) return false;
  const { state } = editor;
  const $f = state.doc.resolve(r.from);
  const parent = $f.parent, idx = $f.index();
  const $t = state.doc.resolve(r.to);
  const last = $t.index() - 1;
  if (dir < 0 && idx === 0) return false;
  if (dir > 0 && last >= parent.childCount - 1) return false;
  const slice = state.doc.slice(r.from, r.to);
  const sel = state.selection;
  const offset = sel.from - r.from, span = sel.to - sel.from;
  const tr = state.tr.delete(r.from, r.to);
  const neighbour = dir < 0 ? parent.child(idx - 1) : parent.child(last + 1);
  const at = dir < 0 ? r.from - neighbour.nodeSize : r.from + neighbour.nodeSize;
  tr.insert(at, slice.content);
  const a = Math.min(at + offset, tr.doc.content.size), b = Math.min(a + span, tr.doc.content.size);
  if (sel instanceof BlockSelection) { const s = blockRange(tr.doc, at, at + slice.content.size - (slice.content.lastChild?.nodeSize ?? 0)); if (s) tr.setSelection(s); }
  else try { tr.setSelection(TextSelection.create(tr.doc, a, b)); } catch { tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1))); }
  editor.view.dispatch(opts.scroll === false ? tr : tr.scrollIntoView());
  if (opts.scroll !== false) editor.view.focus();
  return true;
}
export function duplicateBlock(editor: Editor): boolean {
  const r = currentBlocks(editor);
  if (!r) return false;
  const slice = editor.state.doc.slice(r.from, r.to);
  editor.view.dispatch(editor.state.tr.insert(r.to, slice.content));
  return true;
}
export function deleteBlock(editor: Editor): boolean {
  const r = currentBlocks(editor);
  if (!r) return false;
  const tr = editor.state.tr.delete(r.from, r.to);
  if (!tr.doc.content.size) tr.insert(0, editor.schema.nodes.paragraph.create({ size: "body" }));
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(r.from, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

// ---------- phone select mode (Craft's circles, Oct 27) ----------

/** Turn select mode on (optionally ticking the block at a position) or off. The page can't be typed in meanwhile. */
export function setPickMode(editor: Editor, on: boolean, at?: number | null) {
  const { state } = editor;
  const tr = state.tr.setMeta(pickKey, { active: on });
  if (on) { const p = at == null ? null : pickStartAt(state.doc, at); tr.setSelection(new PickSelection(state.doc, p === null ? [] : [p])); }
  else if (state.selection instanceof PickSelection) {
    const last = state.selection.picks[state.selection.picks.length - 1];
    tr.setSelection(last === undefined ? Selection.atStart(state.doc) : TextSelection.near(state.doc.resolve(Math.min(last + 1, state.doc.content.size))));
  }
  editor.setEditable(!on);
  editor.view.dispatch(tr);
  if (on) (document.activeElement as HTMLElement | null)?.blur?.();
}
export const isPicking = (editor: Editor | null) => !!editor && !editor.isDestroyed && pickActive(editor.state);
export const picks = (editor: Editor): number[] => (editor.state.selection instanceof PickSelection ? editor.state.selection.picks : []);

/** Tick or untick the block under a tap. */
export function togglePickAt(editor: Editor, coords: { left: number; top: number }): boolean {
  const r = editor.view.posAtCoords(coords);
  if (!r) return false;
  const { doc } = editor.state;
  const p = pickStartAt(doc, r.inside >= 0 ? r.inside : r.pos);
  if (p === null) return false;
  const cur = picks(editor);
  const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
  editor.view.dispatch(editor.state.tr.setSelection(new PickSelection(doc, next)));
  return true;
}
export function pickAll(editor: Editor, all: number[]) { editor.view.dispatch(editor.state.tr.setSelection(new PickSelection(editor.state.doc, all))); }

/** Delete every ticked block (one undo step). */
export function deletePicked(editor: Editor): number {
  const ps = picks(editor);
  if (!ps.length) return 0;
  const { state } = editor;
  const tr = state.tr;
  for (const p of [...ps].sort((a, b) => b - a)) { const n = tr.doc.nodeAt(p); if (n) tr.delete(p, p + n.nodeSize); }
  if (!tr.doc.content.size) tr.insert(0, editor.schema.nodes.paragraph.create({ size: "body" }));
  tr.setSelection(new PickSelection(tr.doc, []));
  editor.view.dispatch(tr.scrollIntoView());
  return ps.length;
}
/** Copies of the ticked blocks, each right after its original; the copies become the ticked ones. */
export function duplicatePicked(editor: Editor): number {
  const ps = picks(editor);
  if (!ps.length) return 0;
  const tr = editor.state.tr;
  const made: number[] = [];
  for (const p of [...ps].sort((a, b) => b - a)) {
    const n = tr.doc.nodeAt(p);
    if (!n) continue;
    tr.insert(p + n.nodeSize, n.copy(n.content));
    made.forEach((m, i) => { made[i] = m + n.nodeSize; });
    made.push(p + n.nodeSize);
  }
  tr.setSelection(new PickSelection(tr.doc, made));
  editor.view.dispatch(tr.scrollIntoView());
  return made.length;
}
/** Move the ticked blocks up or down one place. Only when they sit together, one after another. */
export function canMovePicked(editor: Editor): boolean {
  const ps = picks(editor);
  if (!ps.length) return false;
  const { doc } = editor.state;
  const $a = doc.resolve(ps[0]);
  let end = ps[0];
  for (const p of ps) { if (p !== end || doc.resolve(p).parent !== $a.parent) return false; end = p + doc.nodeAt(p)!.nodeSize; }
  return true;
}
export function movePicked(editor: Editor, dir: -1 | 1): boolean {
  if (!canMovePicked(editor)) return false;
  const ps = picks(editor);
  const { state } = editor;
  const from = ps[0], to = ps[ps.length - 1] + state.doc.nodeAt(ps[ps.length - 1])!.nodeSize;
  const $f = state.doc.resolve(from), parent = $f.parent, idx = $f.index(), last = state.doc.resolve(to).index() - 1;
  if (dir < 0 && idx === 0) return false;
  if (dir > 0 && last >= parent.childCount - 1) return false;
  const slice = state.doc.slice(from, to);
  const neighbour = dir < 0 ? parent.child(idx - 1) : parent.child(last + 1);
  const at = dir < 0 ? from - neighbour.nodeSize : from + neighbour.nodeSize;
  const tr = state.tr.delete(from, to).insert(at, slice.content);
  tr.setSelection(new PickSelection(tr.doc, ps.map((p) => p - from + at)));
  const dom = editor.view.nodeDOM(at) as HTMLElement | null;
  editor.view.dispatch(tr);
  (editor.view.nodeDOM(at) as HTMLElement | null ?? dom)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  return true;
}
/** Lists for ticked blocks: each ticked line becomes (or stops being) a list, separately. */
export function toggleListPicked(editor: Editor, kind: "bulletList" | "orderedList"): boolean {
  const ps = picks(editor);
  if (!ps.length) return false;
  const doc = editor.state.doc;
  let chain = editor.chain();
  for (const p of [...ps].sort((a, b) => b - a)) {
    const n = doc.nodeAt(p);
    if (!n || (n.type.name !== "paragraph" && n.type.name !== "bulletList" && n.type.name !== "orderedList")) continue;
    chain = chain.setTextSelection({ from: p + 1, to: p + n.nodeSize - 1 });
    chain = kind === "bulletList" ? chain.toggleBulletList() : chain.toggleOrderedList();
  }
  return chain.command(({ tr }) => {
    tr.setSelection(new PickSelection(tr.doc, ps.map((p) => pickStartAt(tr.doc, tr.mapping.map(p, -1))).filter((x): x is number => x !== null)));
    return true;
  }).run();
}
/** "+ Content": leave select mode with the cursor after the last ticked block, so Insert adds there. */
export function insertAfterPicked(editor: Editor) {
  const ps = picks(editor);
  const last = ps[ps.length - 1];
  setPickMode(editor, false);
  if (last === undefined) return;
  const n = editor.state.doc.nodeAt(last);
  if (!n) return;
  const r = blockRange(editor.state.doc, last, last);
  if (r) editor.view.dispatch(editor.state.tr.setSelection(r));
}
/** The ticked blocks' text, for Copy. */
export function pickedText(editor: Editor): string {
  return picks(editor).map((p) => editor.state.doc.nodeAt(p)?.textBetween(0, editor.state.doc.nodeAt(p)!.content.size, "\n", " ") ?? "").filter(Boolean).join("\n");
}
