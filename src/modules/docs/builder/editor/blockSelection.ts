// Block selection (E3, Oct 27), like Craft: Esc selects the line (block) you're in, Shift+↑/↓ adds the blocks above or
// below, ↑/↓ moves to the next block, Backspace/Delete removes them, Enter goes back to typing, and a drag in the
// page's left margin selects a run of blocks. Formatting (text sizes, marks, alignment, colour) applies to every
// selected block at once.
//
// The selection is a run of sibling blocks inside one container (the page, or a section). It's its own Selection
// type, so the browser draws no text highlight; the blocks get a highlight class instead.
import { Plugin, PluginKey, Selection, SelectionRange, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "@tiptap/pm/model";
import type { Mappable } from "@tiptap/pm/transform";

const CONTAINERS = new Set(["doc", "section"]);

/** The depth of the block (a child of the page or of a section) that holds this position, or -1. */
export function blockDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d >= 1; d--) if (CONTAINERS.has($pos.node(d - 1).type.name)) return d;
  return -1;
}

export class BlockSelection extends Selection {
  constructor($from: ResolvedPos, $to: ResolvedPos, readonly anchorBlock: number, readonly headBlock: number) {
    // The browser's own selection is collapsed at the start, so it paints no text highlight over the blocks (the app's
    // selection colour would turn their text white); the blocks get the highlight class instead.
    super($from, $from, [new SelectionRange($from, $to)]);
  }
  visible = false;
  map(doc: PMNode, mapping: Mappable): Selection {
    // Positions between blocks can be flagged "deleted" when a neighbour is only re-marked up (a text size change),
    // so map them plainly and check they're still block starts.
    const a = blockStartAt(doc, mapping.map(this.anchorBlock, -1)), h = blockStartAt(doc, mapping.map(this.headBlock, -1));
    const r = a !== null && h !== null ? blockRange(doc, a, h) : null;
    return r ?? TextSelection.near(doc.resolve(Math.min(mapping.map(this.from), doc.content.size)));
  }
  eq(other: Selection): boolean { return other instanceof BlockSelection && other.from === this.from && other.to === this.to; }
  toJSON() { return { type: "wsblock", anchor: this.anchorBlock, head: this.headBlock }; }
  static fromJSON(doc: PMNode, json: { anchor: number; head: number }) { return blockRange(doc, json.anchor, json.head) ?? Selection.atStart(doc); }
  content() { return this.$from.doc.slice(this.from, this.to, true); }
  /** The blocks (with their positions) in the selection. */
  blocks(): Array<{ node: PMNode; pos: number }> {
    const out: Array<{ node: PMNode; pos: number }> = [];
    const parent = this.$from.parent, start = this.$from.start();
    let pos = start;
    parent.forEach((child) => { if (pos >= this.from && pos + child.nodeSize <= this.to) out.push({ node: child, pos }); pos += child.nodeSize; });
    return out;
  }
}
try { Selection.jsonID("wsblock", BlockSelection as unknown as typeof Selection); } catch { /* registered already (hot reload) */ }

/**
 * Phone select mode (Craft's circles, Oct 27): any blocks ticked, not just a run. Each ticked block is one range of
 * the selection, so formatting (sizes, alignment, colour, marks) and delete act on exactly those blocks. A block here
 * is a line (or list, or special block) in the page or inside a container; containers themselves aren't ticked.
 */
export class PickSelection extends Selection {
  readonly picks: number[];
  constructor(doc: PMNode, picks: number[]) {
    const ps = [...new Set(picks)].filter((p) => !!doc.nodeAt(p)).sort((a, b) => a - b);
    const ranges = ps.map((p) => new SelectionRange(doc.resolve(p), doc.resolve(p + doc.nodeAt(p)!.nodeSize)));
    if (!ranges.length) { const $s = Selection.atStart(doc).$from; ranges.push(new SelectionRange($s, $s)); }
    super(ranges[0].$from, ranges[0].$from, ranges); // collapsed for the browser, like BlockSelection
    this.picks = ps;
  }
  visible = false;
  map(doc: PMNode, mapping: Mappable): Selection {
    return new PickSelection(doc, this.picks.map((p) => unitAt(doc, mapping.map(p, -1))).filter((p): p is number => p !== null));
  }
  eq(other: Selection): boolean { return other instanceof PickSelection && other.picks.join() === this.picks.join(); }
  toJSON() { return { type: "wspick", picks: this.picks }; }
  static fromJSON(doc: PMNode, json: { picks: number[] }) { return new PickSelection(doc, json.picks ?? []); }
  // Just the ticked blocks (not what lies between them), so copy, cut and drag carry exactly those.
  content() { const doc = this.$from.doc; return new Slice(Fragment.fromArray(this.picks.map((p) => doc.nodeAt(p)!)), 0, 0); }
  blocks(): Array<{ node: PMNode; pos: number }> { const doc = this.$from.doc; return this.picks.map((pos) => ({ node: doc.nodeAt(pos)!, pos })); }
}
try { Selection.jsonID("wspick", PickSelection as unknown as typeof Selection); } catch { /* registered already (hot reload) */ }

/** Every block that can be ticked: the page's children, and the lines inside containers (not the containers). */
export function pickableBlocks(doc: PMNode): number[] {
  const out: number[] = [];
  doc.forEach((n, pos) => {
    if (n.type.name === "section") n.forEach((c, off) => out.push(pos + 1 + off));
    else out.push(pos);
  });
  return out;
}
/** The tickable block at (or holding) this position. */
export function pickStartAt(doc: PMNode, pos: number): number | null {
  const all = pickableBlocks(doc);
  let best: number | null = null;
  for (const p of all) { if (p <= pos && pos < p + doc.nodeAt(p)!.nodeSize) best = p; }
  return best;
}
/** Like pickStartAt, but a container (a clause, a card) picked as a whole stays the container (computers: its handle). */
export function unitAt(doc: PMNode, pos: number): number | null {
  const n = pos >= 0 && pos < doc.content.size ? doc.nodeAt(pos) : null;
  if (n?.type.name === "section" && doc.resolve(pos).parent.type.name === "doc") return pos;
  return pickStartAt(doc, pos);
}
/** Every block from one position to another's block, in page order: a container wholly inside is one block. */
export function unitsBetween(doc: PMNode, a: number, b: number): number[] {
  const from = Math.min(a, b), endPos = Math.max(a, b), end = endPos + (doc.nodeAt(endPos)?.nodeSize ?? 1);
  const out: number[] = [];
  doc.forEach((n, pos) => {
    if (pos + n.nodeSize <= from || pos >= end) return;
    if (n.type.name === "section" && !(pos >= from && pos + n.nodeSize <= end)) n.forEach((c, off) => { const cp = pos + 1 + off; if (cp + c.nodeSize > from && cp < end) out.push(cp); });
    else out.push(pos);
  });
  return out;
}
export const pickKey = new PluginKey<{ active: boolean }>("wsPick");
export const pickActive = (state: EditorState) => !!pickKey.getState(state)?.active;

/** The circles: while select mode is on, every block shows one, filled when ticked. */
export function pickPlugin() {
  return new Plugin<{ active: boolean }>({
    key: pickKey,
    state: {
      init: () => ({ active: false }),
      apply: (tr, v) => { const m = tr.getMeta(pickKey) as { active: boolean } | undefined; return m ?? v; },
    },
    props: {
      decorations(state) {
        if (!pickActive(state)) return null;
        const sel = state.selection;
        const on = new Set(sel instanceof PickSelection ? sel.picks : []);
        return DecorationSet.create(state.doc, pickableBlocks(state.doc).map((p) => Decoration.node(p, p + state.doc.nodeAt(p)!.nodeSize, { class: on.has(p) ? "wsb-pickable wsb-picked" : "wsb-pickable" })));
      },
    },
  });
}

/** The start of the block (a child of the page or of a section) at this position. */
export function blockStartAt(doc: PMNode, pos: number, inside = -1): number | null {
  if (inside >= 0) {
    const $i = doc.resolve(inside);
    if (CONTAINERS.has($i.parent.type.name)) return inside; // an atom or a section, right where the pointer is
  }
  const $p = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  if ($p.nodeAfter && CONTAINERS.has($p.parent.type.name)) return $p.pos; // right at a block's start
  const d = blockDepth($p);
  if (d >= 1) return $p.before(d);
  if ($p.nodeAfter) return $p.pos;
  if ($p.nodeBefore) return $p.pos - $p.nodeBefore.nodeSize;
  return null;
}

/**
 * The run of sibling blocks from the block starting at `a` to the one starting at `b`. When the two are in different
 * containers, it widens to their shared container (a section and the lines after it, say).
 */
export function blockRange(doc: PMNode, a: number, b: number): BlockSelection | null {
  const $a = doc.resolve(a), $b = doc.resolve(b);
  let shared = $a.sharedDepth(b);
  while (shared > 0 && !CONTAINERS.has($a.node(shared).type.name)) shared--;
  const d = shared + 1; // the blocks are the shared container's children
  const startOf = ($p: ResolvedPos) => ($p.depth >= d ? $p.before(d) : $p.pos);
  const endOf = ($p: ResolvedPos) => ($p.depth >= d ? $p.after(d) : $p.pos + ($p.nodeAfter?.nodeSize ?? 0));
  const as = startOf($a), bs = startOf($b);
  const from = Math.min(as, bs), to = Math.max(endOf($a), endOf($b));
  if (to <= from) return null;
  return new BlockSelection(doc.resolve(from), doc.resolve(to), as, bs);
}

/** The block the cursor (or the selection) is in, as a block selection. */
export function selectCurrentBlock(state: EditorState): BlockSelection | null {
  const sel = state.selection;
  if (sel instanceof BlockSelection) return sel;
  const a = blockStartAt(state.doc, sel.from, (sel as { node?: PMNode }).node ? sel.from : -1);
  const b = sel.from === sel.to ? a : blockStartAt(state.doc, sel.to - 1);
  return a === null || b === null ? null : blockRange(state.doc, a, b);
}

function sibling(doc: PMNode, sel: BlockSelection, dir: -1 | 1): number | null {
  const $head = doc.resolve(sel.headBlock);
  const parent = $head.parent, index = $head.index();
  const target = index + dir;
  if (target < 0 || target >= parent.childCount) return null;
  let pos = $head.start();
  for (let i = 0; i < target; i++) pos += parent.child(i).nodeSize;
  return pos;
}

export const blockSelectionKey = new PluginKey("wsBlockSelection");

export function blockSelectionPlugin() {
  return new Plugin({
    key: blockSelectionKey,
    props: {
      decorations(state) {
        const sel = state.selection;
        // On a computer (Craft-style), blocks clicked by their handle are a PickSelection without select mode's circles.
        if (sel instanceof PickSelection && !pickActive(state)) return DecorationSet.create(state.doc, sel.blocks().map((b) => Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: "wsb-bsel" })));
        // The line(s) you're typing in: the only place the pointer is a text cursor (computers).
        if (sel instanceof TextSelection) {
          const a = blockStartAt(state.doc, sel.from), b = blockStartAt(state.doc, Math.max(sel.from, sel.to - 1));
          const r = a !== null && b !== null ? blockRange(state.doc, a, b) : null;
          return r ? DecorationSet.create(state.doc, r.blocks().map((x) => Decoration.node(x.pos, x.pos + x.node.nodeSize, { class: "wsb-editing" }))) : null;
        }
        if (!(sel instanceof BlockSelection)) return null;
        return DecorationSet.create(state.doc, sel.blocks().map((b) => Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: "wsb-bsel" })));
      },
      handleKeyDown(view, e) {
        const { state } = view;
        const sel = state.selection;
        if (sel instanceof PickSelection && !pickActive(state)) return pickKeys(view, sel, e);
        if (e.key === "Escape" && !(sel instanceof BlockSelection)) {
          const b = selectCurrentBlock(state);
          if (b) { view.dispatch(state.tr.setSelection(b)); return true; }
          return false;
        }
        if (!(sel instanceof BlockSelection)) return false;
        const go = (s: Selection | null) => { if (s) view.dispatch(state.tr.setSelection(s).scrollIntoView()); return true; };
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const dir = e.key === "ArrowDown" ? 1 : -1;
          const next = sibling(state.doc, sel, dir);
          if (next === null) return true;
          return go(e.shiftKey ? blockRange(state.doc, sel.anchorBlock, next) : blockRange(state.doc, next, next));
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          view.dispatch(state.tr.deleteRange(sel.from, sel.to).scrollIntoView());
          return true;
        }
        if (e.key === "Escape") {
          // Esc again selects the container the blocks are in (a clause, a card).
          const $f = sel.$from;
          if ($f.depth >= 1 && $f.node($f.depth).type.name === "section") return go(blockRange(state.doc, $f.before($f.depth), $f.before($f.depth)));
          return true;
        }
        if (e.key === "Enter") return go(TextSelection.near(state.doc.resolve(sel.to - 1), -1));
        // Copy, cut, the formatting shortcuts and Ctrl+1–6 work on the blocks; any other key goes back to typing.
        if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Shift" || e.key.length > 1) return false;
        view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(sel.to - 1), -1)));
        return false;
      },
      // Craft: a drag across lines selects the whole blocks (a drag within one line stays a text selection).
      handleDOMEvents: {
        mousedown(view, e) {
          if (e.button !== 0 || e.detail > 1) return false;
          const up = () => {
            window.removeEventListener("mouseup", up);
            setTimeout(() => {
              if (view.isDestroyed) return;
              const s = view.state.selection;
              if (!(s instanceof TextSelection) || s.empty) return;
              const a = blockStartAt(view.state.doc, s.from), b = blockStartAt(view.state.doc, s.to - 1);
              if (a === null || b === null || a === b) return;
              const r = blockRange(view.state.doc, s.anchor < s.head ? a : b, s.anchor < s.head ? b : a);
              if (r) view.dispatch(view.state.tr.setSelection(r));
            }, 0);
          };
          window.addEventListener("mouseup", up);
          return false;
        },
      },
      // A drop or paste over selected blocks replaces them, like any selection.
      handlePaste(view, _e, slice: Slice) {
        const sel = view.state.selection;
        if (!(sel instanceof BlockSelection)) return false;
        view.dispatch(view.state.tr.replaceRange(sel.from, sel.to, slice).scrollIntoView());
        return true;
      },
    },
  });
}

/** Keys while blocks are selected by their handles: Esc or Enter goes back to typing, Backspace deletes them, ↑/↓
 *  moves to the block above or below (Shift adds it), and any other key types at the end of the last one. */
function pickKeys(view: EditorView, sel: PickSelection, e: KeyboardEvent): boolean {
  const { state } = view;
  const ps = sel.picks;
  const last = ps[ps.length - 1];
  const toText = (at: number) => view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(at, state.doc.content.size)), -1)));
  if (last === undefined) return false;
  const lastEnd = last + state.doc.nodeAt(last)!.nodeSize;
  if (e.key === "Escape" || e.key === "Enter") { toText(lastEnd - 1); return true; }
  if (e.key === "Backspace" || e.key === "Delete") {
    const tr = state.tr;
    for (const p of [...ps].sort((a, b) => b - a)) { const n = tr.doc.nodeAt(p); if (n) tr.delete(p, p + n.nodeSize); }
    if (!tr.doc.content.size) tr.insert(0, state.schema.nodes.paragraph.create({ size: "body" }));
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.mapping.map(ps[0]), tr.doc.content.size))));
    view.dispatch(tr.scrollIntoView());
    return true;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const all = pickableBlocks(state.doc);
    const i = all.indexOf(e.key === "ArrowDown" ? last : ps[0]) + (e.key === "ArrowDown" ? 1 : -1);
    if (i < 0 || i >= all.length) return true;
    view.dispatch(state.tr.setSelection(new PickSelection(state.doc, e.shiftKey ? [...ps, all[i]] : [all[i]])).scrollIntoView());
    return true;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Shift" || e.key.length > 1) return false;
  toText(lastEnd - 1);
  return false;
}

/** Drag in the page's left margin to select a run of blocks (the page wires the mouse events here). */
export function marginSelect(view: EditorView, startY: number, left: number): () => void {
  const at = (y: number) => { const r = view.posAtCoords({ left, top: y }); return r ? blockStartAt(view.state.doc, r.pos, r.inside) : null; };
  const a = at(startY);
  if (a === null) return () => {};
  const set = (y: number) => {
    const b = at(y);
    if (b === null) return;
    const r = blockRange(view.state.doc, a, b);
    if (r) view.dispatch(view.state.tr.setSelection(r));
  };
  set(startY);
  view.focus();
  const move = (e: MouseEvent) => set(e.clientY);
  const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  return up;
}

export const isBlockSelection = (t: Transaction | EditorState) => t.selection instanceof BlockSelection;
