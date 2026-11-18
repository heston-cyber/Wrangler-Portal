// Nov 17 (Heston, 18:16, approved 18:24): creative docs on the canvas. A doc is the creative doc itself (not a copy): on
// the board it reads as its page; a double-click edits it right there with the builder's own editor, while the board's
// left panel becomes the builder's Format panel and right-click is the builder's menu. Edits save to the doc, so they show
// in Creative planning › Docs too. Only the owner and the team edit (a shared board shows docs to read); phones read.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Editor } from "@tiptap/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageEditor } from "../docs/builder/editor/PageEditor";
import { BuilderCtx } from "../docs/builder/editor/nodes";
import { cssFamily } from "../docs/builder/fonts";
import { PAGE_PT, fieldValues, type BuildDoc } from "../../../convex/lib/wsBuilder";
import { errText } from "../docs/pages/common";

export type DocView = { title: string; kindName: string; buildId: string | null; page: unknown; style: unknown; fields: unknown; at: number };
type Style = BuildDoc["style"];
const NO_MISSING = new Set<string>();
const BLANK_BIZ = { name: "", legalName: "", contact: "", title: "", email: "", phone: "", address: "" };
/** Every field the page's placeholders read, blank where the board wasn't given it. */
function fullFields(f: unknown): BuildDoc["fields"] {
  const x = (f ?? {}) as Partial<BuildDoc["fields"]>;
  return { business: { ...BLANK_BIZ, ...(x.business ?? {}) }, client: { name: "", company: "", email: "", phone: "", address: "", ...(x.client ?? {}) }, project: x.project ?? "", date: x.date ?? "", custom: x.custom ?? [] } as BuildDoc["fields"];
}
const noop = () => {};

/** The page's look on the board: the doc's own paper, ink and fonts, sized to the item's width. */
function pageLook(st: Style, width: number) {
  const scale = width / PAGE_PT[st.pageSize].w;
  const px = (pt: number) => pt * scale;
  const H = cssFamily(st.fonts.heading.family), B = cssFamily(st.fonts.body.family);
  const style: React.CSSProperties = {
    background: st.page, color: st.text, fontFamily: B, fontSize: px(st.baseSize), padding: `${px(st.margin) * 0.6}px`,
    ["--wsb-accent" as string]: st.accent, ["--wsb-muted" as string]: st.muted, ["--wsb-heading" as string]: st.heading,
    ["--wsb-hfont" as string]: H, ["--wsb-bfont" as string]: B, ["--wsb-text" as string]: st.text, ["--wsb-pagebg" as string]: st.page,
  };
  return { px, style };
}

/** A doc on the board, to read (its text can't be changed here; double-click to edit). */
export function DocCard({ view, width }: { view: DocView; width: number }) {
  const doc = useMemo(() => ({ title: view.title, page: view.page, fields: fullFields(view.fields), signers: [], style: view.style }) as unknown as BuildDoc, [view]);
  const { px, style } = pageLook(doc.style, width);
  const ctx = useMemo(() => ({ doc, values: fieldValues(doc.fields, doc.page), px, onDetails: noop, onSaveClause: noop, shots: null }), [doc, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const onEditor = useCallback((e: Editor | null) => { if (e && !e.isDestroyed && e.isEditable) e.setEditable(false); }, []);
  return (
    <BuilderCtx.Provider value={ctx}>
      <div className="wsb-page cv-docpage" style={style}>
        {/* the page key changes when the doc changes, so an edit made elsewhere shows here */}
        <PageEditor key={view.at} page={doc.page} onChange={noop} onEditor={onEditor} onSelectText={noop} onMenu={noop} missing={NO_MISSING} />
      </div>
    </BuilderCtx.Provider>
  );
}

/** A doc being edited on the board: the builder's editor, saving to the doc a moment after each change. */
export function DocLive({ buildId, width, onEditor, onMenu, onError }: {
  buildId: string; width: number; onEditor: (e: Editor | null, doc: BuildDoc | null) => void; onMenu: (at: { x: number; y: number }) => void; onError: (m: string) => void;
}) {
  const build = useQuery(api.builder.getBuild, { buildId: buildId as Id<"wsBuilds"> });
  const saveBuild = useMutation(api.builder.saveBuild);
  const [doc, setDoc] = useState<BuildDoc | null>(null);
  const docRef = useRef<BuildDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => {
    if (!build || docRef.current) return;
    const d = { title: build.title, page: build.blocks, fields: fullFields(build.fields), signers: build.signers ?? [], style: build.style } as unknown as BuildDoc;
    docRef.current = d; setDoc(d);
  }, [build]);
  const onPage = useCallback((page: BuildDoc["page"]) => {
    const d = docRef.current; if (!d) return;
    const n = { ...d, page }; docRef.current = n; setDoc(n); setDirty(true);
  }, []);
  useEffect(() => {
    if (!dirty || !doc) return;
    const t = setTimeout(async () => {
      const saved = doc;
      try {
        await saveBuild({ buildId: buildId as Id<"wsBuilds">, title: doc.title, blocks: doc.page, fields: doc.fields, signers: doc.signers, style: doc.style });
        if (docRef.current === saved) setDirty(false);
      } catch (e) { onError(errText(e)); }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saves what's left when editing ends (Esc or a click outside) before the save above had its moment.
  useEffect(() => () => {
    const d = docRef.current;
    if (d && dirtyRef.current) void saveBuild({ buildId: buildId as Id<"wsBuilds">, title: d.title, blocks: d.page, fields: d.fields, signers: d.signers, style: d.style }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => { onEditor(editor, doc); }, [editor, doc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onEditor(null, null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editor && !editor.isDestroyed) editor.commands.focus("end"); }, [editor]);
  if (!doc) return <div className="wsb-page cv-docpage cv-docload">Opening the doc…</div>;
  const { px, style } = pageLook(doc.style, width);
  return (
    <BuilderCtx.Provider value={{ doc, values: fieldValues(doc.fields, doc.page), px, onDetails: noop, onSaveClause: noop, shots: null }}>
      <div className="wsb-page cv-docpage cv-docedit" style={style}>
        <PageEditor page={doc.page} onChange={onPage} onEditor={setEditor} onSelectText={noop} onMenu={onMenu} missing={NO_MISSING} />
      </div>
    </BuilderCtx.Provider>
  );
}
