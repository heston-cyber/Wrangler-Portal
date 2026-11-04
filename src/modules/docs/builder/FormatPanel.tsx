// Formatting the page (E1, Oct 27): the Format tab and the right-click menu. Both act on every line in the selection
// (or the line with the cursor), like Craft's Format sidebar.
import { useContext, useEffect, useReducer, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { sheetDay } from "../../../../convex/lib/callSheet";
import { StatusChip } from "../../../ui/wp";
import { errText } from "../pages/common";
import { BuilderCtx, WX_CHIP, weatherNow } from "./editor/nodes";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, BookmarkPlus, Bold, ClipboardPaste, Copy, Indent, Italic, List, ListOrdered, Outdent,
  CopyPlus, Paintbrush, RemoveFormatting, Scissors, SquareDashed, SlidersHorizontal, Strikethrough, Trash2, Type, Underline, Ungroup, Group, Palette,
} from "lucide-react";
import { ContextMenu, MenuItem, MenuLabel, MenuSep, MenuSub } from "../../../ui/kit";
import { TEXT_SIZES, type PNode, type TextSize } from "../../../../convex/lib/wsBuilder";
import {
  clearFormatting, currentSection, deleteBlock, duplicateBlock, lineAttr, moveBlock, selectedAtom, setAtom, setLines, setSection, setSize, toggleDeco, unwrapSection, wrapInSection,
} from "./editor/commands";
import { BlockSelection, PickSelection } from "./editor/blockSelection";
import { canMovePicked, deletePicked, duplicatePicked, isPicking, movePicked, picks, toggleListPicked } from "./editor/commands";

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
  // On a phone the sheet covers the lower half of the screen: keep the moved block in view above it.
  const shown = (ok: boolean) => { if (ok) requestAnimationFrame(() => keepInView(editor)); };
  return (
    <div className="field"><span className="ws-flabel">Block</span><div className="ws-seg wsb-marks">
      {/* Selected blocks (by handle, ⌘-click or a drag) move, copy and delete together. */}
      <button aria-label="Move up" title="Move up" onMouseDown={keep} onClick={() => shown(picks(editor).length ? movePicked(editor, -1) : moveBlock(editor, -1, { scroll: false }))}><ArrowUp size={15} /></button>
      <button aria-label="Move down" title="Move down" onMouseDown={keep} onClick={() => shown(picks(editor).length ? movePicked(editor, 1) : moveBlock(editor, 1, { scroll: false }))}><ArrowDown size={15} /></button>
      <button aria-label="Duplicate" title="Duplicate" onMouseDown={keep} onClick={() => shown(picks(editor).length ? duplicatePicked(editor) > 0 : duplicateBlock(editor))}><Copy size={15} /></button>
      <button aria-label="Delete" title="Delete" onMouseDown={keep} onClick={() => (picks(editor).length ? deletePicked(editor) : deleteBlock(editor))}><Trash2 size={15} /></button>
    </div></div>
  );
}

/** Scroll the page just enough that the block with the selection sits between the top bar and an open sheet. */
function keepInView(editor: Editor) {
  if (editor.isDestroyed) return;
  const at = editor.view.domAtPos(editor.state.selection.from);
  let el: HTMLElement | null = (at.node.nodeType === 1 ? at.node : at.node.parentElement) as HTMLElement | null;
  if (el && el.childNodes[at.offset] instanceof HTMLElement && el.classList.contains("wsb-doc")) el = el.childNodes[at.offset] as HTMLElement;
  const block = el?.closest(".wsb-doc > *, .wsb-sec-body > *") as HTMLElement | null ?? el;
  if (!block) return;
  let sc: HTMLElement | null = block.parentElement;
  while (sc && !(/(auto|scroll)/.test(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
  const scroller = sc ?? (document.scrollingElement as HTMLElement);
  const panel = document.querySelector(".wsb-panel.open")?.getBoundingClientRect();
  const topLimit = 64, bottomLimit = (panel && panel.top > 0 ? panel.top : innerHeight) - 16;
  const r = block.getBoundingClientRect();
  if (r.top < topLimit) scroller.scrollBy({ top: r.top - topLimit, behavior: "smooth" });
  else if (r.bottom > bottomLimit) scroller.scrollBy({ top: Math.min(r.bottom - bottomLimit, r.top - topLimit), behavior: "smooth" });
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
  if (atom && atom.node.type.name === "weather") return <WeatherPanel key={atom.pos} editor={editor} pos={atom.pos} attrs={atom.node.attrs} />;
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
      {picked > 0 && <p className="caption secondary">{picked} block{picked === 1 ? "" : "s"} selected: changes here apply to all of them.</p>}
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
  const block = editor.state.selection instanceof BlockSelection || editor.state.selection instanceof PickSelection;
  const n = block ? picks(editor).length : 0;
  const clip = (cmd: "copy" | "cut") => { editor.commands.focus(); document.execCommand(cmd); };
  const paste = async () => { try { const t = await navigator.clipboard.readText(); editor.chain().focus().insertContent(t).run(); } catch { editor.commands.focus(); } };
  const sizeHint: Record<TextSize, string> = { title: "H1", subtitle: "H2", heading: "H3", strong: "Bolded", body: "Regular text size", caption: "Fine print" };
  return (
    <ContextMenu at={at} onClose={onClose} label="Format">
      {block && <MenuLabel>{n} block{n === 1 ? "" : "s"}</MenuLabel>}
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
      {block && <>
        <MenuItem icon={<CopyPlus size={15} />} onSelect={() => duplicatePicked(editor)}>Duplicate</MenuItem>
        <MenuItem icon={<ArrowUp size={15} />} disabled={!canMovePicked(editor)} onSelect={() => movePicked(editor, -1)}>Move up</MenuItem>
        <MenuItem icon={<ArrowDown size={15} />} disabled={!canMovePicked(editor)} onSelect={() => movePicked(editor, 1)}>Move down</MenuItem>
        <MenuItem icon={<Trash2 size={15} />} danger kbd="⌫" onSelect={() => { deletePicked(editor); editor.commands.focus(); }}>Delete {n === 1 ? "block" : "blocks"}</MenuItem>
      </>}
      <MenuSep />
      <MenuItem icon={<SlidersHorizontal size={15} />} onSelect={onMore}>More in Format…</MenuItem>
    </ContextMenu>
  );
}

// ---------- D148: the Weather block's settings (865:11023, states 865:11728) ----------

const updated = (at: number) => new Date(at).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const monthDay = (ymd: string) => sheetDay(ymd).replace(/^\w+ /, "");

function WeatherPanel({ editor, pos, attrs }: { editor: Editor; pos: number; attrs: Record<string, unknown> }) {
  const ctx = useContext(BuilderCtx);
  const refresh = useMutation(api.callSheets.refreshWeather);
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = weatherNow(ctx, attrs);
  const line = w ? w.line : String(attrs.line ?? "");
  const type = (text: string) => setAtom(editor, pos, { typed: true, line: text.slice(0, 160) });
  const typeOver = () => { if (w && w.state !== "typed") type(line); requestAnimationFrame(() => input.current?.focus()); };
  const remove = () => { editor.chain().setNodeSelection(pos).run(); deleteBlock(editor); };
  const lookUp = async () => {
    if (!ctx?.callSheetId) return;
    setBusy(true); setNote(null);
    try {
      const r = await refresh({ callSheetId: ctx.callSheetId as Id<"callSheets"> });
      setNote(r.state === "early" ? "The shoot is more than a week away: the forecast doesn't reach it yet." : r.state === "recent" ? "It was looked up a moment ago." : "Looking it up. It shows here in a few seconds.");
    } catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  };
  const again = () => { setAtom(editor, pos, { typed: false, line: "" }); if (w && !w.forecast && w.due) void lookUp(); };
  const place = w?.place || "the shoot's address";
  const caption = !w ? "This is a template: on a shoot's call sheet the line fills in from the forecast for its address."
    : w.state === "forecast" ? `From the National Weather Service${w.at ? ` · updated ${updated(w.at)}` : ""}. Refreshes by itself the day before.`
    : w.state === "typed" ? "You typed this, so the forecast no longer changes it."
    : w.state === "early" ? (w.due ? "The forecast fills in with the daily check (about 5 PM), or press Refresh forecast." : `The forecast reaches about a week ahead. This shoot is ${monthDay(w.date)}, so it fills on ${monthDay(w.fillsOn)}.`)
    : "There is no forecast for this address. It needs a US address. Type it in, or remove the block.";
  const act = (label: string, run: () => void, primary = false) => <button type="button" className={primary ? "btn outline sm" : "btn ghost sm"} onMouseDown={keep} onClick={run}>{label}</button>;
  return (
    <div className="wsb-wx-panel">
      <span className="ws-flabel">Weather block</span>
      <p className="caption secondary">Filled in from the forecast for {place}. It appears when the shoot is within a week and refreshes the day before. Type over it any time; it is optional.</p>
      {w && <StatusChip tone={WX_CHIP[w.state].tone}>{WX_CHIP[w.state].text}</StatusChip>}
      <label className="field"><span className="ws-flabel">Shows on the sheet</span>
        <input ref={input} className="input" value={line} placeholder={w?.state === "early" || w?.state === "none" ? "Sunny · 62°/48° · 10% rain · wind 8 mph" : ""} maxLength={160} onChange={(e) => type(e.target.value)} aria-label="Weather line" />
      </label>
      <p className="caption secondary">{caption}</p>
      {note && <p className="caption">{note}</p>}
      <div className="wsb-row">
        {w?.state === "forecast" && <>{ctx?.callSheetId && <button type="button" className="btn outline sm" disabled={busy} onMouseDown={keep} onClick={() => void lookUp()}>Refresh forecast</button>}{act("Type over it", typeOver)}</>}
        {w?.state === "typed" && act("Use the forecast again", again, true)}
        {w?.state === "early" && <>{act("Type it in now", typeOver, true)}{w.due && ctx?.callSheetId && <button type="button" className="btn ghost sm" disabled={busy} onMouseDown={keep} onClick={() => void lookUp()}>Refresh forecast</button>}{act("Remove the block", remove)}</>}
        {w?.state === "none" && <>{act("Type it in", typeOver, true)}{act("Remove the block", remove)}</>}
        {!w && act("Remove the block", remove)}
      </div>
    </div>
  );
}
