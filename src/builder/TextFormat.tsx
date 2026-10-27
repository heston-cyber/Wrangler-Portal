// Formatting the selected text (Oct 27): the Format tab's "Selected text" section, and the quick menu that opens on a
// right-click over highlighted text on the page. Bold, italic, underline and lists work inside text areas (the Tiptap
// editors); titles and headings are single fields, so they get the block's own options (alignment, colour) instead.
// Shift + right-click still opens the browser's own menu (spelling suggestions and so on).
import { useEffect, useReducer } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, ClipboardPaste, Copy, Italic, List, ListOrdered, RemoveFormatting, Scissors, SlidersHorizontal, Underline,
} from "lucide-react";
import { ContextMenu, MenuItem, MenuLabel, MenuSep } from "../ui/kit";
import type { Fmt } from "../../convex/lib/wsBuilder";

/** Re-render whenever the editor's selection or content changes, so the buttons show what's on. */
export function useEditorTick(editor: Editor | null) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", bump);
    editor.on("selectionUpdate", bump);
    return () => { editor.off("transaction", bump); editor.off("selectionUpdate", bump); };
  }, [editor]);
}

const MARKS = [
  { key: "bold", label: "Bold", kbd: "⌘B", icon: <Bold size={15} />, run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { key: "italic", label: "Italic", kbd: "⌘I", icon: <Italic size={15} />, run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { key: "underline", label: "Underline", kbd: "⌘U", icon: <Underline size={15} />, run: (e: Editor) => e.chain().focus().toggleUnderline().run() },
  { key: "bulletList", label: "Bulleted list", kbd: "", icon: <List size={15} />, run: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { key: "orderedList", label: "Numbered list", kbd: "", icon: <ListOrdered size={15} />, run: (e: Editor) => e.chain().focus().toggleOrderedList().run() },
] as const;

/** The Format tab's section for the text that's selected in a text area. */
export function SelectedTextTools({ editor }: { editor: Editor }) {
  useEditorTick(editor);
  return (
    <div className="field">
      <span className="ws-flabel">Selected text</span>
      <div className="ws-seg wsb-marks">
        {MARKS.map((m) => (
          <button key={m.key} className={editor.isActive(m.key) ? "on" : ""} aria-label={m.label} title={m.kbd ? `${m.label} (${m.kbd})` : m.label} aria-pressed={editor.isActive(m.key)}
            onMouseDown={(e) => { e.preventDefault(); m.run(editor); }}>{m.icon}</button>
        ))}
        <button aria-label="Clear formatting" title="Clear formatting" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetAllMarks().clearNodes().run(); }}><RemoveFormatting size={15} /></button>
      </div>
    </div>
  );
}

export type QuickAt = { x: number; y: number; target: HTMLElement; editor: Editor | null };

/** Right-click over highlighted text on the page. */
export function QuickFormatMenu({ at, fmt, setFmt, onMore, onClose }: { at: QuickAt; fmt: Fmt; setFmt: (p: Partial<Fmt>) => void; onMore: () => void; onClose: () => void }) {
  const { editor, target } = at;
  useEditorTick(editor);
  const refocus = () => { if (editor) editor.commands.focus(); else target.focus(); };
  const clip = (cmd: "copy" | "cut") => { refocus(); document.execCommand(cmd); };
  const paste = async () => {
    try { const text = await navigator.clipboard.readText(); refocus(); document.execCommand("insertText", false, text); }
    catch { refocus(); }
  };
  return (
    <ContextMenu at={at} onClose={onClose} label="Format the selection">
      {editor && <>
        <MenuLabel>Text</MenuLabel>
        {MARKS.map((m) => <MenuItem key={m.key} icon={m.icon} kbd={m.kbd || undefined} checked={editor.isActive(m.key)} onSelect={() => m.run(editor)}>{m.label}</MenuItem>)}
        <MenuItem icon={<RemoveFormatting size={15} />} onSelect={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>Clear formatting</MenuItem>
        <MenuSep />
      </>}
      <MenuItem icon={<Scissors size={15} />} kbd="⌘X" onSelect={() => clip("cut")}>Cut</MenuItem>
      <MenuItem icon={<Copy size={15} />} kbd="⌘C" onSelect={() => clip("copy")}>Copy</MenuItem>
      <MenuItem icon={<ClipboardPaste size={15} />} kbd="⌘V" onSelect={() => void paste()}>Paste</MenuItem>
      <MenuSep />
      <MenuLabel>Block</MenuLabel>
      {([["left", "Align left", <AlignLeft size={15} key="l" />], ["center", "Centre", <AlignCenter size={15} key="c" />], ["right", "Align right", <AlignRight size={15} key="r" />]] as const).map(([a, label, icon]) => (
        <MenuItem key={a} icon={icon} checked={(fmt.align ?? "left") === a} onSelect={() => { setFmt({ align: a }); refocus(); }}>{label}</MenuItem>
      ))}
      <MenuItem icon={<SlidersHorizontal size={15} />} onSelect={() => { onMore(); refocus(); }}>More in Format…</MenuItem>
    </ContextMenu>
  );
}

/** True when the page has highlighted text in a field or text area (not just a cursor). */
export function hasTextSelection(): boolean {
  const a = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) {
    try { return a.selectionStart !== null && a.selectionStart !== a.selectionEnd; } catch { return false; }
  }
  const s = window.getSelection();
  return !!s && !s.isCollapsed && !!(s.anchorNode && (s.anchorNode as HTMLElement).parentElement?.closest("[contenteditable=true]"));
}
