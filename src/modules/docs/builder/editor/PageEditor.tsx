// The page as one Craft-style editor (E1–E3, Oct 27): every line is a block with a text style, containers hold lines,
// the special blocks sit between them. Hover a block for its drag handle; drag Insert items or library clauses in;
// select across lines (or Esc for block selection) and format them together.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { Ellipsis, GripVertical } from "lucide-react";
import { isAtom, type Page, type PNode } from "../../../../../convex/lib/wsBuilder";
import { Atoms, BlockSelect, FieldHighlight, Line, Section, fieldsKey } from "./schema";
import { BlockSelection, PickSelection, blockStartAt, unitAt, unitsBetween } from "./blockSelection";
import { clickBlock, dropNodes, picks } from "./commands";

/** Insert items and library clauses carry their nodes in this drag type (not text, so nothing pastes them as text). */
export const INSERT_MIME = "application/x-wrangler-nodes";
// The nodes being dragged from the panel. A drag's data can't be read until the drop, so the page keeps them here to
// show the drop line between blocks (and inside containers) while dragging.
let dragged: PNode[] | null = null;
export function startInsertDrag(e: React.DragEvent, nodes: PNode[]) {
  dragged = nodes;
  e.dataTransfer.setData(INSERT_MIME, JSON.stringify(nodes));
  e.dataTransfer.effectAllowed = "copy";
}
export function endInsertDrag(editor: Editor | null) {
  dragged = null;
  if (editor && !editor.isDestroyed) (editor.view as unknown as { dragging: unknown }).dragging = null;
}

export function PageEditor({ page, onChange, onEditor, onSelectText, onMenu, missing }: {
  page: Page;
  onChange: (p: Page) => void;
  onEditor: (e: Editor | null) => void;
  onSelectText: () => void;
  onMenu: (at: { x: number; y: number }) => void;
  missing: Set<string>;
}) {
  const last = useRef(JSON.stringify(page));
  const missingRef = useRef(missing);
  missingRef.current = missing;
  const hadSelection = useRef(false);
  const cb = useRef({ onChange, onSelectText });
  cb.current = { onChange, onSelectText };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ paragraph: false, heading: false, codeBlock: false, blockquote: false, code: false, horizontalRule: false, link: false, undoRedo: false, dropcursor: { width: 3, class: "wsb-dropcursor" }, trailingNode: { node: "paragraph" } }),
      Line, Section, ...Atoms,
      FieldHighlight.configure({ missing: () => missingRef.current }),
      BlockSelect,
      Placeholder.configure({ placeholder: "Type, or Ctrl+1–6 for a text style", showOnlyCurrent: true, includeChildren: true }),
    ],
    content: page,
    editorProps: {
      attributes: { class: "wsb-doc", spellcheck: "true" },
      handleDrop: (view, e) => {
        const raw = e.dataTransfer?.getData(INSERT_MIME);
        if (!raw) return false;
        e.preventDefault();
        (view as unknown as { dragging: unknown }).dragging = null;
        dragged = null;
        try { return dropNodes(editorRef.current!, JSON.parse(raw) as PNode[], { left: e.clientX, top: e.clientY }); } catch { return false; }
      },
    },
    onUpdate: ({ editor: e }) => { const j = e.getJSON() as Page; last.current = JSON.stringify(j); cb.current.onChange(j); },
    onSelectionUpdate: ({ editor: e }) => {
      const s = e.state.selection;
      // Phones: tapping a special block (parties, line items, signatures…) selects it without the keyboard coming up.
      if (s instanceof NodeSelection && isAtom(s.node.type.name) && matchMedia("(pointer: coarse)").matches && document.activeElement === e.view.dom) (e.view.dom as HTMLElement).blur();
      const has = !s.empty || s instanceof BlockSelection;
      if (has && !hadSelection.current) cb.current.onSelectText();
      hadSelection.current = has;
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;
  useEffect(() => {
    onEditor(editor);
    if (location.hostname === "localhost") (window as unknown as { __wsEditor: unknown }).__wsEditor = editor; // screenshot harness checks
    return () => onEditor(null);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Outside changes (undo and redo, a document opened fresh) replace the content; the editor's own don't.
  useEffect(() => {
    if (!editor) return;
    const s = JSON.stringify(page);
    if (s === last.current) return;
    last.current = s;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(page, { emitUpdate: false });
    const end = editor.state.doc.content.size;
    try { editor.commands.setTextSelection({ from: Math.min(from, end), to: Math.min(to, end) }); } catch { /* outside the new text */ }
  }, [page, editor]);
  // Field highlights follow the Details tab (a filled-in field stops being marked missing).
  const missingKey = [...missing].sort().join(",");
  useEffect(() => { if (editor) editor.view.dispatch(editor.state.tr.setMeta("wsFieldsRefresh", true)); }, [missingKey, editor]);
  void fieldsKey;

  // The drag handle: beside the block under the pointer (a line, a container, or a special block).
  const wrap = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<{ pos: number; top: number; left: number; right: number } | null>(null);
  // Leaving the page for the handle (left) or the ⋯ (right) crosses a gap, so the two stay a moment before hiding.
  const hideTimer = useRef<number | null>(null);
  const keepHandle = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; } };
  const hideSoon = () => { keepHandle(); hideTimer.current = window.setTimeout(() => setHandle(null), 450); };
  const onMove = (e: React.MouseEvent) => {
    if (!editor || !wrap.current || (e.buttons & 1) || gesture.current) return;
    keepHandle();
    if ((e.target as HTMLElement).closest(".wsb-handle, .wsb-more")) return;
    const content = editor.view.dom.getBoundingClientRect();
    const x = Math.max(content.left + 4, Math.min(e.clientX, content.right - 4));
    const r = editor.view.posAtCoords({ left: x, top: e.clientY });
    if (!r) return;
    const pos = blockStartAt(editor.state.doc, r.pos, r.inside);
    if (pos === null) { setHandle(null); return; }
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom?.getBoundingClientRect) return;
    const b = dom.getBoundingClientRect(), w = wrap.current.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(dom).lineHeight) || 20;
    const top = b.top - w.top + (dom.matches("p") ? Math.max(0, (Math.min(lh, b.height) - 22) / 2) : 2);
    const right = Math.min(b.right, content.right) - w.left + 6;
    if (handle?.pos !== pos || handle.top !== top || handle.right !== right) setHandle({ pos, top, left: b.left - w.left - 28, right });
  };
  const onDragStart = (e: React.DragEvent) => {
    if (!editor || !handle) return;
    const { view, state } = editor;
    const node = state.doc.nodeAt(handle.pos);
    if (!node) return;
    // Dragging a block that's part of the selected blocks drags all of them (Craft shows how many on the drag).
    const sel = state.selection;
    const inSel = (sel instanceof BlockSelection && handle.pos >= sel.from && handle.pos < sel.to) || (sel instanceof PickSelection && sel.picks.some((p) => handle.pos >= p && handle.pos < p + state.doc.nodeAt(p)!.nodeSize));
    const range = inSel ? sel : NodeSelection.create(state.doc, handle.pos);
    if (range !== sel) view.dispatch(state.tr.setSelection(range));
    const slice = range.content();
    const html = document.createElement("div");
    html.appendChild(DOMSerializer.fromSchema(state.schema).serializeFragment(slice.content));
    e.dataTransfer.clearData();
    e.dataTransfer.setData("text/html", html.innerHTML);
    e.dataTransfer.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n"));
    e.dataTransfer.effectAllowed = "copyMove";
    const dom = view.nodeDOM(handle.pos) as HTMLElement | null;
    const count = inSel ? picks(editor).length : 1;
    if (dom && count > 1) {
      // The dragged block with a count badge, like Craft's "5".
      const ghost = document.createElement("div");
      ghost.className = "wsb-dragghost wsb-doc";
      ghost.style.width = `${dom.getBoundingClientRect().width}px`;
      ghost.appendChild(dom.cloneNode(true));
      const badge = document.createElement("span"); badge.className = "n"; badge.textContent = String(count); ghost.appendChild(badge);
      (wrap.current ?? document.body).appendChild(ghost); // beside the editor, never inside its own DOM
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    } else if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
    (view as unknown as { dragging: unknown }).dragging = { slice, move: true };
  };
  // Clicks on the page, with a mouse (Heston, Oct 29). The pointer stays an arrow over the page:
  //   - a click on a line selects it as a block; a click on a selected line puts the cursor there to type;
  //   - a drag from a line selects every block it passes; a drag from a selected line moves the selected blocks;
  //   - ⌘ (Ctrl on Windows) + click adds or removes a line; Shift+click selects the run up to it;
  //   - in the line you're typing in, everything works as text (click, drag to select words, double-click).
  // Caught before the page sees the click (containers' own views would otherwise keep it). Phones are unchanged.
  const gesture = useRef<{ x: number; y: number; started: boolean } | null>(null);
  const [mv, setMv] = useState<{ x: number; y: number; n: number; label: string; line: { top: number; left: number; width: number } | null } | null>(null);
  const blockAt = (ed: Editor, x: number, y: number): number | null => {
    const c = ed.view.dom.getBoundingClientRect();
    const r = ed.view.posAtCoords({ left: Math.max(c.left + 2, Math.min(x, c.right - 2)), top: y });
    return r ? blockStartAt(ed.state.doc, r.pos, r.inside) : null;
  };
  const selectedUnit = (ed: Editor, pos: number): boolean => {
    const { doc } = ed.state;
    return picks(ed).some((p) => p === pos || (pos > p && pos < p + doc.nodeAt(p)!.nodeSize));
  };
  /** Where the selected blocks would land for the pointer at y: before or after the block under it. */
  const dropAt = (ed: Editor, x: number, y: number): { at: number; line: { top: number; left: number; width: number } } | null => {
    const b = blockAt(ed, x, y);
    if (b === null || selectedUnit(ed, b)) return null;
    const dom = ed.view.nodeDOM(b) as HTMLElement | null;
    const n = ed.state.doc.nodeAt(b);
    if (!dom?.getBoundingClientRect || !n) return null;
    const r = dom.getBoundingClientRect();
    const before = y < r.top + r.height / 2;
    return { at: before ? b : b + n.nodeSize, line: { top: before ? r.top - 2 : r.bottom + 1, left: r.left, width: r.width } };
  };
  const moveSelected = (ed: Editor, at: number) => {
    const { state } = ed;
    const ps = [...picks(ed)].sort((a, b) => a - b);
    const nodes = ps.map((p) => state.doc.nodeAt(p)!).filter(Boolean);
    if (!nodes.length) return;
    const tr = state.tr;
    for (const p of [...ps].reverse()) tr.delete(p, p + state.doc.nodeAt(p)!.nodeSize);
    let to = tr.mapping.map(at);
    try { tr.insert(to, Fragment.fromArray(nodes)); }
    catch {
      // Something that can't sit inside a container (a special block): put it after the container instead.
      const $t = tr.doc.resolve(to);
      to = $t.depth ? $t.after(1) : to;
      try { tr.insert(to, Fragment.fromArray(nodes)); } catch { return; }
    }
    const made: number[] = []; let q = to;
    for (const n of nodes) { made.push(q); q += n.nodeSize; }
    tr.setSelection(new PickSelection(tr.doc, made));
    ed.view.dispatch(tr.scrollIntoView());
  };
  const onPickClick = (e: React.MouseEvent) => {
    const ed = editor;
    if (!ed || e.button !== 0 || !ed.isEditable) return;
    if ((e.target as HTMLElement).closest(".wsb-handle, .wsb-more, input, textarea, select, button, a, label")) return;
    const add = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    const range = e.shiftKey && !add && picks(ed).length > 0;
    const pos = blockAt(ed, e.clientX, e.clientY);
    if (pos === null) return;
    if (add || range) { e.preventDefault(); e.stopPropagation(); clickBlock(ed, pos, add ? "toggle" : "range"); return; }
    if (!matchMedia("(pointer: fine)").matches || e.shiftKey || e.altKey) return;
    // The line you're typing in behaves as text.
    const s = ed.state.selection;
    if (s instanceof TextSelection && ed.view.hasFocus()) {
      const a = blockStartAt(ed.state.doc, s.from), b = blockStartAt(ed.state.doc, Math.max(s.from, s.to - 1));
      if (pos === a || pos === b) return;
    }
    if (e.detail > 1) return; // double-click: straight to the word, as text
    e.preventDefault(); e.stopPropagation();
    const unit = unitAt(ed.state.doc, pos) ?? pos;
    const moving = selectedUnit(ed, pos);
    gesture.current = { x: e.clientX, y: e.clientY, started: false };
    setHandle(null);
    if (!ed.view.hasFocus()) ed.view.focus();
    const label = (() => { const ps = picks(ed); const n = ed.state.doc.nodeAt(ps[0] ?? unit); return (n?.textContent || n?.type.name || "").slice(0, 40); })();
    const move = (m: MouseEvent) => {
      const g = gesture.current;
      if (!g) return;
      if (!g.started && Math.hypot(m.clientX - g.x, m.clientY - g.y) < 5) return;
      g.started = true;
      if (moving) { const d = dropAt(ed, m.clientX, m.clientY); setMv({ x: m.clientX, y: m.clientY, n: picks(ed).length, label, line: d?.line ?? null }); }
      else {
        const b = blockAt(ed, m.clientX, m.clientY);
        if (b !== null) { const u = unitAt(ed.state.doc, b) ?? b; const list = unitsBetween(ed.state.doc, unit, u); ed.view.dispatch(ed.state.tr.setSelection(new PickSelection(ed.state.doc, list))); }
      }
    };
    const up = (m: MouseEvent) => {
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      const g = gesture.current; gesture.current = null; setMv(null);
      if (!g) return;
      if (g.started) { if (moving) { const d = dropAt(ed, m.clientX, m.clientY); if (d) moveSelected(ed, d.at); } return; }
      if (!moving) { clickBlock(ed, pos, "one"); return; }
      // A click on a selected line: type there.
      const node = ed.state.doc.nodeAt(unit);
      if (node && isAtom(node.type.name)) { ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, unit))); return; }
      const r = ed.view.posAtCoords({ left: m.clientX, top: m.clientY });
      const at = r ? r.pos : unit + 1;
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.near(ed.state.doc.resolve(Math.min(at, ed.state.doc.content.size)))));
      ed.view.focus();
    };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const onHandleClick = (e: React.MouseEvent) => {
    if (!editor || !handle || !editor.state.doc.nodeAt(handle.pos)) return;
    // A click on the handle selects the block; Shift+click selects the run to it; ⌘/Ctrl+click adds or removes it.
    clickBlock(editor, handle.pos, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "one");
  };
  const onMoreClick = (e: React.MouseEvent) => {
    if (!editor || !handle || !editor.state.doc.nodeAt(handle.pos)) return;
    // Craft's ⋯: selects the block (keeping a selection it's already part of) and opens its menu.
    const on = picks(editor).some((p) => handle.pos >= p && handle.pos < p + editor.state.doc.nodeAt(p)!.nodeSize);
    if (!on || e.shiftKey || e.metaKey || e.ctrlKey) clickBlock(editor, handle.pos, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "one");
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onMenu({ x: r.left - 4, y: r.bottom + 4 });
  };

  return (
    <div className="wsb-editor" ref={wrap} onMouseMove={onMove} onMouseLeave={hideSoon} onMouseDownCapture={onPickClick}
      onDragEnterCapture={() => {
        // A panel drag over the page: hand the editor its nodes, so the drop line sits where they'll actually go.
        if (!editor || !dragged || (editor.view as unknown as { dragging: unknown }).dragging) return;
        try {
          const frag = Fragment.fromArray(dragged.map((n) => editor.schema.nodeFromJSON(n)));
          (editor.view as unknown as { dragging: unknown }).dragging = { slice: new Slice(frag, 0, 0), move: false };
        } catch { /* not valid here */ }
      }}
      onContextMenu={(e) => {
        if (e.shiftKey || !editor) return; // Shift+right-click: the browser's own menu (spelling and so on)
        const s = editor.state.selection;
        if (s.empty && !(s instanceof BlockSelection)) return;
        e.preventDefault();
        onMenu({ x: e.clientX, y: e.clientY });
      }}>
      {handle && (
        <span className="wsb-handle" style={{ top: handle.top, left: handle.left }} draggable onDragStart={onDragStart} onDragEnd={() => setHandle(null)} onMouseEnter={keepHandle} onMouseLeave={hideSoon}
          onMouseDown={(e) => e.stopPropagation()} onClick={onHandleClick} title="Drag to move · click to select (Shift or ⌘ to select more)" aria-label="Drag to move, click to select" role="button">
          <GripVertical size={15} />
        </span>
      )}
      {handle && (
        <button type="button" className="wsb-more" style={{ top: handle.top, left: handle.right }} onMouseEnter={keepHandle} onMouseLeave={hideSoon} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={onMoreClick} title="Select this block and show its menu" aria-label="Block menu">
          <Ellipsis size={14} />
        </button>
      )}
      <EditorContent editor={editor} />
      {mv && <>
        {mv.line && <div className="wsb-tdragline" style={{ top: mv.line.top, left: mv.line.left, width: mv.line.width }} />}
        <div className="wsb-mvghost" style={{ left: mv.x, top: mv.y }}>{mv.n > 1 && <span className="n">{mv.n}</span>}{mv.label || "Block"}</div>
      </>}
    </div>
  );
}
