// Formatting the page (E1, Oct 27): the Format tab and the right-click menu. Both act on every line in the selection
// (or the line with the cursor), like Craft's Format sidebar.
import { useEffect, useReducer } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, BookmarkPlus, Bold, ClipboardPaste, Copy, Indent, Italic, List, ListOrdered, Outdent,
  Paintbrush, RemoveFormatting, Scissors, SquareDashed, SlidersHorizontal, Strikethrough, Trash2, Type, Underline, Ungroup, Group, Palette,
} from "lucide-react";
import { ContextMenu, MenuItem, MenuLabel, MenuSep, MenuSub } from "../ui/kit";
import { TEXT_SIZES, type PNode, type TextSize } from "../../convex/lib/wsBuilder";
import {
  clearFormatting, currentSection, deleteBlock, duplicateBlock, lineAttr, moveBlock, selectedAtom, setAtom, setLines, setSection, setSize, toggleDeco, unwrapSection, wrapInSection,
} from "./editor/commands";
import { BlockSelection, PickSelection } from "./editor/blockSelection";
import { isPicking, toggleListPicked } from "./editor/commands";

/** Re-render whenever the editor's selection or content changes, so the buttons show what's on. */
export function useEditorTick(editor: Editor | null) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", bump);
    return () => { editor.off("transaction", bump); };
  }, [editor]);
}

export const SWATCHES = ["", "accent", "#1d1d1f", "#6b6862", "#1f3a5f", "#2e6b3f", "#8a3d03", "#7a2a8a"];
const SWATCH_NAME: Record<string, string> = { "": "Default", accent: "Accent", "#1d1d1f": "Ink", "#6b6862": "Grey", "#1f3a5f": "Navy", "#2e6b3f": "Green", "#8a3d03": "Brown", "#7a2a8a": "Purple" };
const ALIGNS = [["left", "Left", AlignLeft], ["center", "Centre", AlignCenter], ["right", "Right", AlignRight], ["justify", "Justify", AlignJustify]] as const;
const MARKS = [
  { key: "bold", label: "Bold", kbd: "⌘B", Icon: Bold, run: (e: Editor) => e.chain().focus().toggleBold().run() },
  { key: "italic", label: "Italic", kbd: "⌘I", Icon: Italic, run: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { key: "underline", label: "Underline", kbd: "⌘U", Icon: Underline, run: (e: Editor) => e.chain().focus().toggleUnderline().run() },
  { key: "strike", label: "Strikethrough", kbd: "⇧⌘S", Icon: Strikethrough, run: (e: Editor) => e.chain().focus().toggleStrike().run() },
] as const;
const keep = (e: React.MouseEvent) => e.preventDefault(); // panel buttons don't take the cursor out of the page

/** Move, copy or delete the block with the cursor (or the selected blocks); on a phone this is how blocks move. */
function BlockBar({ editor }: { editor: Editor }) {
  return (
    <div className="field"><span className="ws-flabel">Block</span><div className="ws-seg wsb-marks">
      <button aria-label="Move up" title="Move up" onMouseDown={keep} onClick={() => moveBlock(editor, -1)}><ArrowUp size={15} /></button>
      <button aria-label="Move down" title="Move down" onMouseDown={keep} onClick={() => moveBlock(editor, 1)}><ArrowDown size={15} /></button>
      <button aria-label="Duplicate" title="Duplicate" onMouseDown={keep} onClick={() => duplicateBlock(editor)}><Copy size={15} /></button>
      <button aria-label="Delete" title="Delete" onMouseDown={keep} onClick={() => deleteBlock(editor)}><Trash2 size={15} /></button>
    </div></div>
  );
}

export function FormatPanel({ editor, accent, onSaveClause }: { editor: Editor | null; accent: string; onSaveClause: (s: PNode) => void }) {
  useEditorTick(editor);
  if (!editor) return <p className="caption secondary">Click into the page to format it.</p>;
  // In phone select mode the action bar moves and deletes; this sheet is just the style of the ticked blocks.
  const picking = isPicking(editor);
  if (picking && !(editor.state.selection as PickSelection).picks?.length) return <p className="caption secondary">Tick some blocks first.</p>;
  return <div className="wsb-pane wsb-format">{!picking && <BlockBar editor={editor} />}<FormatBody editor={editor} accent={accent} onSaveClause={onSaveClause} /></div>;
}
function FormatBody({ editor, accent, onSaveClause }: { editor: Editor; accent: string; onSaveClause: (s: PNode) => void }) {
  const atom = selectedAtom(editor);
  if (atom && atom.node.type.name === "spacer") {
    return <label className="field"><span className="ws-flabel">Space height (pt)</span><input className="input sm" type="number" min={4} max={200} value={Number(atom.node.attrs.size) || 18} onChange={(e) => setAtom(editor, atom.pos, { size: Math.max(4, Math.min(200, Number(e.target.value) || 18)) })} /></label>;
  }
  if (atom) return <p className="caption secondary">{atom.node.type.name === "divider" ? "Divider lines are styled in Style › Separator." : atom.node.type.name === "pagebreak" ? "A new page starts here in the PDF." : "This block's settings are on the block itself."}</p>;
  const size = lineAttr(editor, "size", "body");
  const align = lineAttr(editor, "align", "left");
  const color = lineAttr(editor, "color", null);
  const deco = lineAttr(editor, "deco", null);
  const font = lineAttr(editor, "font", null);
  const sec = currentSection(editor);
  const block = editor.state.selection instanceof BlockSelection;
  const picked = editor.state.selection instanceof PickSelection ? editor.state.selection.picks.length : 0;
  const inList = !picked && (editor.isActive("bulletList") || editor.isActive("orderedList"));
  const pickedKinds = picked ? new Set((editor.state.selection as PickSelection).blocks().map((b) => b.node.type.name)) : null;
  const list = (k: "bulletList" | "orderedList") => (picked ? toggleListPicked(editor, k) : k === "bulletList" ? editor.chain().focus().toggleBulletList().run() : editor.chain().focus().toggleOrderedList().run());
  const listOn = (k: "bulletList" | "orderedList") => (pickedKinds ? pickedKinds.size === 1 && pickedKinds.has(k) : editor.isActive(k));
  return (
    <>
      {picked > 0 && <p className="caption secondary">{picked} block{picked === 1 ? "" : "s"} ticked: changes here apply to all of them.</p>}
      {block && <p className="caption secondary">{editor.state.selection instanceof BlockSelection ? (editor.state.selection as BlockSelection).blocks().length : 0} blocks selected. Shift+↑/↓ adds more, Enter goes back to typing.</p>}
      <div className="field"><span className="ws-flabel">Text</span>
        <div className="wsb-sizes">{TEXT_SIZES.map((z, i) => <button key={z.key} className={`wsb-size ${z.key}${size === z.key ? " on" : ""}`} onMouseDown={keep} onClick={() => setSize(editor, z.key)} title={`${z.label} (${z.hint}) · Ctrl+${i + 1}`}>{z.label}</button>)}</div>
      </div>
      <div className="ws-seg wsb-marks">
        {MARKS.map((m) => <button key={m.key} className={editor.isActive(m.key) ? "on" : ""} aria-pressed={editor.isActive(m.key)} aria-label={m.label} title={`${m.label} (${m.kbd})`} onMouseDown={keep} onClick={() => m.run(editor)}><m.Icon size={15} /></button>)}
      </div>
      <div className="ws-seg wsb-marks">
        <button className={listOn("bulletList") ? "on" : ""} aria-label="Bulleted list" title="Bulleted list" onMouseDown={keep} onClick={() => list("bulletList")}><List size={15} /></button>
        <button className={listOn("orderedList") ? "on" : ""} aria-label="Numbered list" title="Numbered list" onMouseDown={keep} onClick={() => list("orderedList")}><ListOrdered size={15} /></button>
        <button aria-label="Outdent" title="Outdent (⇧Tab)" disabled={!inList} onMouseDown={keep} onClick={() => editor.chain().focus().liftListItem("listItem").run()}><Outdent size={15} /></button>
        <button aria-label="Indent" title="Indent (Tab)" disabled={!inList} onMouseDown={keep} onClick={() => editor.chain().focus().sinkListItem("listItem").run()}><Indent size={15} /></button>
        <button aria-label="Clear formatting" title="Clear formatting" onMouseDown={keep} onClick={() => clearFormatting(editor)}><RemoveFormatting size={15} /></button>
      </div>
      <div className="field"><span className="ws-flabel">Alignment</span><div className="ws-seg">
        {ALIGNS.map(([a, label, Icon]) => <button key={a} className={align === a ? "on" : ""} aria-label={label} title={label} onMouseDown={keep} onClick={() => setLines(editor, { align: a === "left" ? null : a })}><Icon size={14} /></button>)}
      </div></div>
      <div className="field"><span className="ws-flabel">Decorations</span><div className="ws-seg">
        <button className={deco === "focus" ? "on" : ""} onMouseDown={keep} onClick={() => toggleDeco(editor, "focus")}>Focus line</button>
        <button className={deco === "block" ? "on" : ""} onMouseDown={keep} onClick={() => toggleDeco(editor, "block")}>Block</button>
      </div></div>
      <div className="field"><span className="ws-flabel">Colour</span><div className="wsb-swatches">
        {SWATCHES.map((c) => <button key={c || "default"} className={`wsb-swatch${(color ?? "") === c ? " on" : ""}`} style={{ background: c === "accent" ? accent : c || "transparent" }} onMouseDown={keep} onClick={() => setLines(editor, { color: c || null })} aria-label={SWATCH_NAME[c]} title={SWATCH_NAME[c]}>{!c && "A"}</button>)}
        <input type="color" aria-label="Pick a colour" value={color && color.startsWith("#") ? color : "#000000"} onChange={(e) => setLines(editor, { color: e.target.value })} />
      </div></div>
      <div className="field"><span className="ws-flabel">Font</span><div className="ws-seg">
        <button className={!font ? "on" : ""} onMouseDown={keep} onClick={() => setLines(editor, { font: null })} title="Headings use the heading font, the rest the body font">Auto</button>
        <button className={font === "heading" ? "on" : ""} onMouseDown={keep} onClick={() => setLines(editor, { font: "heading" })}>Heading font</button>
        <button className={font === "body" ? "on" : ""} onMouseDown={keep} onClick={() => setLines(editor, { font: "body" })}>Body font</button>
      </div></div>
      {picked > 0 ? null : <><span className="label">Container</span>
      {sec ? <>
        <div className="ws-seg">
          <button className={sec.node.attrs.look !== "card" ? "on" : ""} onMouseDown={keep} onClick={() => setSection(editor, { look: "plain" })}>Section</button>
          <button className={sec.node.attrs.look === "card" ? "on" : ""} onMouseDown={keep} onClick={() => setSection(editor, { look: "card" })}>Card</button>
        </div>
        <label className="wsb-check"><input type="checkbox" checked={!!sec.node.attrs.initials} onChange={(e) => setSection(editor, { initials: e.target.checked })} />Client initials at the end</label>
        <div className="wsb-row">
          <button className="btn ghost sm" onMouseDown={keep} onClick={() => onSaveClause(sec.node.toJSON() as PNode)}><BookmarkPlus size={13} />Save to clause library</button>
          <button className="btn ghost sm" onMouseDown={keep} onClick={() => unwrapSection(editor)}><Ungroup size={13} />Take lines out</button>
        </div>
      </> : <>
        <p className="caption secondary">Group the selected lines in a container: a section (a clause, which can ask for the client's initials) or a card.</p>
        <div className="wsb-row">
          <button className="btn ghost sm" onMouseDown={keep} onClick={() => wrapInSection(editor, "plain")}><Group size={13} />Make a section</button>
          <button className="btn ghost sm" onMouseDown={keep} onClick={() => wrapInSection(editor, "card")}><SquareDashed size={13} />Make a card</button>
        </div>
      </>}</>}
    </>
  );
}

export type MenuAt = { x: number; y: number };

/** The right-click menu over a selection. */
export function QuickMenu({ editor, at, accent, onClose, onMore, onSaveClause }: { editor: Editor; at: MenuAt; accent: string; onClose: () => void; onMore: () => void; onSaveClause: (s: PNode) => void }) {
  useEditorTick(editor);
  const size = lineAttr(editor, "size", "body");
  const align = lineAttr(editor, "align", "left");
  const color = lineAttr(editor, "color", null);
  const deco = lineAttr(editor, "deco", null);
  const sec = currentSection(editor);
  const block = editor.state.selection instanceof BlockSelection;
  const clip = (cmd: "copy" | "cut") => { editor.commands.focus(); document.execCommand(cmd); };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); editor.chain().focus().insertContent(t).run(); } catch { editor.commands.focus(); } };
  const sizeHint: Record<TextSize, string> = { title: "H1", subtitle: "H2", heading: "H3", strong: "Bolded", body: "Regular text size", caption: "Fine print" };
  return (
    <ContextMenu at={at} onClose={onClose} label="Format">
      <MenuSub icon={<Type size={15} />} label="Text">
        {TEXT_SIZES.map((z, i) => <MenuItem key={z.key} kbd={`⌃${i + 1}`} checked={size === z.key} onSelect={() => setSize(editor, z.key)}>{z.label} <span className="mhint">({sizeHint[z.key]})</span></MenuItem>)}
      </MenuSub>
      {MARKS.map((m) => <MenuItem key={m.key} icon={<m.Icon size={15} />} kbd={m.kbd} checked={editor.isActive(m.key)} onSelect={() => m.run(editor)}>{m.label}</MenuItem>)}
      <MenuSub icon={<List size={15} />} label="List">
        <MenuItem icon={<List size={15} />} checked={editor.isActive("bulletList")} onSelect={() => editor.chain().focus().toggleBulletList().run()}>Bulleted list</MenuItem>
        <MenuItem icon={<ListOrdered size={15} />} checked={editor.isActive("orderedList")} onSelect={() => editor.chain().focus().toggleOrderedList().run()}>Numbered list</MenuItem>
      </MenuSub>
      <MenuSub icon={<AlignLeft size={15} />} label="Align">
        {ALIGNS.map(([a, label, Icon]) => <MenuItem key={a} icon={<Icon size={15} />} checked={align === a} onSelect={() => setLines(editor, { align: a === "left" ? null : a })}>{label}</MenuItem>)}
      </MenuSub>
      <MenuSub icon={<Palette size={15} />} label="Colour">
        {SWATCHES.map((c) => <MenuItem key={c || "d"} icon={<span className="wsb-dot" style={{ background: c === "accent" ? accent : c || "transparent" }} />} checked={(color ?? "") === c} onSelect={() => setLines(editor, { color: c || null })}>{SWATCH_NAME[c]}</MenuItem>)}
      </MenuSub>
      <MenuSub icon={<Paintbrush size={15} />} label="Decoration">
        <MenuItem checked={!deco} onSelect={() => setLines(editor, { deco: null })}>None</MenuItem>
        <MenuItem checked={deco === "focus"} onSelect={() => setLines(editor, { deco: "focus" })}>Focus line</MenuItem>
        <MenuItem checked={deco === "block"} onSelect={() => setLines(editor, { deco: "block" })}>Block</MenuItem>
      </MenuSub>
      <MenuItem icon={<RemoveFormatting size={15} />} onSelect={() => clearFormatting(editor)}>Clear formatting</MenuItem>
      <MenuSep />
      {sec ? <>
        <MenuItem icon={<BookmarkPlus size={15} />} onSelect={() => onSaveClause(sec.node.toJSON() as PNode)}>Save container to clause library</MenuItem>
        <MenuItem icon={<Ungroup size={15} />} onSelect={() => unwrapSection(editor)}>Take lines out of the container</MenuItem>
      </> : <MenuSub icon={<Group size={15} />} label="Turn into">
        <MenuItem icon={<Group size={15} />} onSelect={() => wrapInSection(editor, "plain")}>Section (a clause)</MenuItem>
        <MenuItem icon={<SquareDashed size={15} />} onSelect={() => wrapInSection(editor, "card")}>Card</MenuItem>
      </MenuSub>}
      <MenuSep />
      <MenuItem icon={<Scissors size={15} />} kbd="⌘X" onSelect={() => clip("cut")}>Cut</MenuItem>
      <MenuItem icon={<Copy size={15} />} kbd="⌘C" onSelect={() => clip("copy")}>Copy</MenuItem>
      <MenuItem icon={<ClipboardPaste size={15} />} kbd="⌘V" onSelect={() => void paste()}>Paste</MenuItem>
      {block && <MenuItem icon={<Trash2 size={15} />} danger kbd="⌫" onSelect={() => editor.chain().focus().deleteSelection().run()}>Delete blocks</MenuItem>}
      <MenuSep />
      <MenuItem icon={<SlidersHorizontal size={15} />} onSelect={onMore}>More in Format…</MenuItem>
      <MenuLabel>Shift+right-click for the browser's menu</MenuLabel>
    </ContextMenu>
  );
}
