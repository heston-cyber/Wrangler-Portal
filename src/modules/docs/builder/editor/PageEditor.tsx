// The page as one Craft-style editor (E1–E3, Oct 27): every line is a block with a text style, containers hold lines,
// the special blocks sit between them. Hover a block for its drag handle; drag Insert items or library clauses in;
// select across lines (or Esc for block selection) and format them together.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { Ellipsis, GripVertical } from "lucide-react";
import { isAtom, type Page, type PNode } from "../../../../../convex/lib/wsBuilder";
import { Atoms, BlockSelect, FieldHighlight, Line, Section, fieldsKey } from "./schema";
import { BlockSelection, PickSelection, blockStartAt } from "./blockSelection";
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
  const onMove = (e: React.MouseEvent) => {
    if (!editor || !wrap.current || (e.buttons & 1)) return;
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
  // Craft: hold ⌘ (Ctrl on Windows) and click lines to select several; once blocks are selected, Shift+click selects
  // the run up to a line. Caught before the page sees the click (containers' own views would otherwise keep it).
  const onPickClick = (e: React.MouseEvent) => {
    const ed = editor;
    if (!ed || e.button !== 0 || !ed.isEditable) return;
    if ((e.target as HTMLElement).closest(".wsb-handle, .wsb-more, input, textarea, select, button")) return;
    const add = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    const range = e.shiftKey && !add && picks(ed).length > 0;
    if (!add && !range) return;
    const r = ed.view.posAtCoords({ left: e.clientX, top: e.clientY });
    if (!r) return;
    const pos = blockStartAt(ed.state.doc, r.pos, r.inside);
    if (pos === null) return;
    e.preventDefault(); e.stopPropagation();
    clickBlock(ed, pos, add ? "toggle" : "range");
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
    <div className="wsb-editor" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHandle(null)} onMouseDownCapture={onPickClick}
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
        <span className="wsb-handle" style={{ top: handle.top, left: handle.left }} draggable onDragStart={onDragStart} onDragEnd={() => setHandle(null)}
          onMouseDown={(e) => e.stopPropagation()} onClick={onHandleClick} title="Drag to move · click to select (Shift or ⌘ to select more)" aria-label="Drag to move, click to select" role="button">
          <GripVertical size={15} />
        </span>
      )}
      {handle && (
        <button type="button" className="wsb-more" style={{ top: handle.top, left: handle.right }} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={onMoreClick} title="Select this block and show its menu" aria-label="Block menu">
          <Ellipsis size={14} />
        </button>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
