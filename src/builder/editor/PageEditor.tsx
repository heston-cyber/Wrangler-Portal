// The page as one Craft-style editor (E1–E3, Oct 27): every line is a block with a text style, containers hold lines,
// the special blocks sit between them. Hover a block for its drag handle; drag Insert items or library clauses in;
// select across lines (or Esc for block selection) and format them together.
import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { NodeSelection } from "@tiptap/pm/state";
import { DOMSerializer, Fragment, Slice } from "@tiptap/pm/model";
import { GripVertical } from "lucide-react";
import { isAtom, type Page, type PNode } from "../../../convex/lib/wsBuilder";
import { Atoms, BlockSelect, FieldHighlight, Line, Section, fieldsKey } from "./schema";
import { BlockSelection, blockRange, blockStartAt } from "./blockSelection";
import { dropNodes } from "./commands";

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
  const [handle, setHandle] = useState<{ pos: number; top: number; left: number } | null>(null);
  const onMove = (e: React.MouseEvent) => {
    if (!editor || !wrap.current || (e.buttons & 1)) return;
    if ((e.target as HTMLElement).closest(".wsb-handle")) return;
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
    if (handle?.pos !== pos || handle.top !== top) setHandle({ pos, top, left: b.left - w.left - 28 });
  };
  const onDragStart = (e: React.DragEvent) => {
    if (!editor || !handle) return;
    const { view, state } = editor;
    const node = state.doc.nodeAt(handle.pos);
    if (!node) return;
    // Dragging a block that's part of a block selection drags the whole selection.
    const sel = state.selection;
    const range = sel instanceof BlockSelection && handle.pos >= sel.from && handle.pos < sel.to ? sel : NodeSelection.create(state.doc, handle.pos);
    if (range !== sel) view.dispatch(state.tr.setSelection(range));
    const slice = range.content();
    const html = document.createElement("div");
    html.appendChild(DOMSerializer.fromSchema(state.schema).serializeFragment(slice.content));
    e.dataTransfer.clearData();
    e.dataTransfer.setData("text/html", html.innerHTML);
    e.dataTransfer.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n"));
    e.dataTransfer.effectAllowed = "copyMove";
    const dom = view.nodeDOM(handle.pos) as HTMLElement | null;
    if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
    (view as unknown as { dragging: unknown }).dragging = { slice, move: true };
  };
  const onHandleClick = (shift: boolean) => {
    if (!editor || !handle || !editor.state.doc.nodeAt(handle.pos)) return;
    // A click on the handle selects the block; Shift+click extends a block selection to it.
    const sel = editor.state.selection;
    const anchor = shift && sel instanceof BlockSelection ? sel.anchorBlock : handle.pos;
    const r = blockRange(editor.state.doc, anchor, handle.pos);
    if (r) { editor.view.dispatch(editor.state.tr.setSelection(r)); editor.view.focus(); }
  };

  return (
    <div className="wsb-editor" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHandle(null)}
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
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => onHandleClick(e.shiftKey)} title="Drag to move · click to select" aria-label="Drag to move, click to select" role="button">
          <GripVertical size={15} />
        </span>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
