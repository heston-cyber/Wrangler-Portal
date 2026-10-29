// A text area for the builder (B2): Tiptap with bold, italic, underline and lists. Stores Tiptap's JSON (the same
// shape the PDF renderer and the clause library use).
import { createContext, useContext, useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import type { Rich } from "../../../../convex/lib/wsBuilder";

/** The builder listens here for the text editor that has the cursor, so its Format tab can format the selected text. */
export const ActiveEditor = createContext<(e: Editor | null) => void>(() => {});

export function RichEditor({ value, onChange, placeholder, style, className }: { value: Rich; onChange: (r: Rich) => void; placeholder?: string; style?: React.CSSProperties; className?: string }) {
  const last = useRef(JSON.stringify(value));
  const setActive = useContext(ActiveEditor);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, code: false, horizontalRule: false, strike: false, link: false, dropcursor: false, undoRedo: false })],
    content: value,
    editorProps: { attributes: { class: "wsb-rich", ...(placeholder ? { "data-placeholder": placeholder } : {}) } },
    onFocus: ({ editor: e }) => setActive(e as Editor),
    onUpdate: ({ editor: e }) => { const j = e.getJSON() as Rich; last.current = JSON.stringify(j); onChange(j); },
  });
  // Undo and redo are the builder's (one history for the whole document), so the editor's own is off.
  // Outside changes (undo and redo, a clause re-inserted) replace the content; our own edits don't.
  useEffect(() => {
    if (!editor) return;
    const s = JSON.stringify(value);
    if (s === last.current) return;
    last.current = s;
    // Keep the cursor where it was (clamped to the new text), so typing carries on after an undo.
    const focused = editor.isFocused, { from, to } = editor.state.selection;
    editor.commands.setContent(value, { emitUpdate: false });
    if (focused) {
      const end = editor.state.doc.content.size - 1;
      editor.chain().setTextSelection({ from: Math.max(1, Math.min(from, end)), to: Math.max(1, Math.min(to, end)) }).focus().run();
    }
  }, [value, editor]);
  if (!editor) return null;
  const btn = (on: boolean, label: string, icon: React.ReactNode, run: () => void) => (
    <button type="button" className={`icon-btn${on ? " on" : ""}`} aria-label={label} title={label} onMouseDown={(e) => { e.preventDefault(); run(); }}>{icon}</button>
  );
  const empty = editor.isEmpty;
  return (
    <div className={`wsb-richwrap${className ? ` ${className}` : ""}`} style={style}>
      <div className="wsb-richbar" role="toolbar" aria-label="Text format">
        {btn(editor.isActive("bold"), "Bold", <Bold size={14} />, () => editor.chain().focus().toggleBold().run())}
        {btn(editor.isActive("italic"), "Italic", <Italic size={14} />, () => editor.chain().focus().toggleItalic().run())}
        {btn(editor.isActive("underline"), "Underline", <Underline size={14} />, () => editor.chain().focus().toggleUnderline().run())}
        {btn(editor.isActive("bulletList"), "Bulleted list", <List size={14} />, () => editor.chain().focus().toggleBulletList().run())}
        {btn(editor.isActive("orderedList"), "Numbered list", <ListOrdered size={14} />, () => editor.chain().focus().toggleOrderedList().run())}
      </div>
      {empty && placeholder && <span className="wsb-ph" aria-hidden>{placeholder}</span>}
      <EditorContent editor={editor} />
    </div>
  );
}
