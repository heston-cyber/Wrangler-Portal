// The doc builder (B2, Oct 27; one Craft-style editor since E1), laid out like Craft: the outline on the left, the
// page in the middle (every line is a block you edit where it sits), and a panel on the right with Insert · Format ·
// Style · Details. It edits either a build (a document on its way to signing) or a template. Everything saves as you go.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  BookmarkPlus, Check, Eye, FileSignature, Heading, Heading1, LayoutTemplate, List, Minus, PanelTop, PenLine, Plus, Receipt, Redo2, Undo2,
  ScrollText, Send, SeparatorHorizontal, Space, TriangleAlert, Type, Users, X,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Sep, TopBar } from "../shell/Shell";
import { linkProps, navigate } from "../lib/router";
import { Modal, Spinner, useToast } from "../ui/kit";
import {
  FIELD_HELP, INSERT_LABEL, PAGE_PT, buildProblems, clauseSection, emptyFields, fieldValues, fill, missingFields, money, newNodes, pageOf, sectionClause, signerKeys, totals,
  type BuildDoc, type ExtraSigner, type Fields, type InsertKind, type PNode, type Style,
} from "../../convex/lib/wsBuilder";
import { cssFamily, loadForScreen, type FontRow } from "./fonts";
import { StylePanel } from "./StylePanel";
import { FormatPanel, QuickMenu, useEditorTick, type MenuAt } from "./FormatPanel";
import { PageEditor, endInsertDrag, startInsertDrag } from "./editor/PageEditor";
import { BuilderCtx } from "./editor/nodes";
import { insertKind, insertNodes, outline } from "./editor/commands";
import { marginSelect } from "./editor/blockSelection";
import { errText, uploadToStorage } from "../pages/sign/common";

type Mode = { kind: "build"; buildId: Id<"wsBuilds"> } | { kind: "template"; templateId: Id<"wsTemplates"> };
type Tab = "insert" | "format" | "style" | "details";
type Meta = { name: string; description: string };

const INSERT: Array<{ kind: InsertKind; icon: React.ReactNode; hint: string }> = [
  { kind: "title", icon: <Heading1 size={16} />, hint: "The document's title (Ctrl+1)" },
  { kind: "heading", icon: <Heading size={16} />, hint: "A section heading (Ctrl+3)" },
  { kind: "text", icon: <Type size={16} />, hint: "A line of text (Ctrl+5)" },
  { kind: "section", icon: <ScrollText size={16} />, hint: "A container of lines: a clause, with optional initials" },
  { kind: "card", icon: <PanelTop size={16} />, hint: "A tinted container of lines" },
  { kind: "parties", icon: <Users size={16} />, hint: "You and the client" },
  { kind: "items", icon: <List size={16} />, hint: "Services with qty, rate, total" },
  { kind: "payment", icon: <Receipt size={16} />, hint: "Deposit and balance (sets the Stripe draft)" },
  { kind: "signatures", icon: <PenLine size={16} />, hint: "Signature, name, title and date lines" },
  { kind: "divider", icon: <Minus size={16} />, hint: "A line between sections" },
  { kind: "pagebreak", icon: <SeparatorHorizontal size={16} />, hint: "Start a new page" },
  { kind: "spacer", icon: <Space size={16} />, hint: "Some empty space" },
];

export default function Builder({ mode }: { mode: Mode }) {
  const build = useQuery(api.builder.getBuild, mode.kind === "build" ? { buildId: mode.buildId } : "skip");
  const tpl = useQuery(api.builder.getTemplate, mode.kind === "template" ? { templateId: mode.templateId } : "skip");
  const profile = useQuery(api.builder.getProfile);
  const fonts = useQuery(api.builder.listFonts);
  const clauses = useQuery(api.builder.listClauses);
  const saveBuild = useMutation(api.builder.saveBuild);
  const updateTemplate = useMutation(api.builder.updateTemplate);
  const saveAsTemplate = useMutation(api.builder.saveAsTemplate);
  const saveClause = useMutation(api.builder.saveClause);
  const createBuild = useMutation(api.builder.createBuild);
  const uploadUrl = useMutation(api.builder.uploadUrl);
  const toSigning = useAction(api.builder.toSigning);
  const ensureGoogle = useAction(api.builder.ensureGoogleFont);
  const [toast, show] = useToast();

  const [doc, setDocRaw] = useState<BuildDoc | null>(null);
  const [meta, setMeta] = useState<Meta>({ name: "", description: "" });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [tab, setTab] = useState<Tab>("insert");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [asTemplate, setAsTemplate] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  useEditorTick(editor);

  // First load only: after that the page's copy is the truth and saves go up. Older documents (a list of blocks) are
  // converted to the page editor's lines here.
  useEffect(() => {
    if (doc) return;
    if (mode.kind === "build" && build) setDocRaw({ title: build.title, page: pageOf(build.blocks), fields: build.fields as Fields, signers: (build.signers as ExtraSigner[]) ?? [], style: build.style as Style });
    if (mode.kind === "template" && tpl && profile) {
      const f = { ...emptyFields(profile), ...(tpl.fields as Partial<Fields>) } as Fields;
      setDocRaw({ title: tpl.name, page: pageOf(tpl.blocks), fields: { ...f, business: profile, client: emptyFields(profile).client }, signers: [], style: tpl.style as Style });
      setMeta({ name: tpl.name, description: tpl.description ?? "" });
    }
  }, [build, tpl, profile, doc, mode.kind]);

  // Undo and redo (⌘Z, ⇧⌘Z or ⌘Y; the buttons in the bar): one history for the whole document, the page and the
  // panels alike. Changes made within a second of each other (typing a sentence, dragging a colour) are one step.
  const docRef = useRef<BuildDoc | null>(null);
  docRef.current = doc;
  const hist = useRef<{ past: BuildDoc[]; future: BuildDoc[]; at: number }>({ past: [], future: [], at: 0 });
  const [, setHistTick] = useState(0);
  const setDoc = useCallback((f: (d: BuildDoc) => BuildDoc) => {
    const d = docRef.current;
    if (!d) return;
    const n = f(d);
    if (n === d) return;
    const h = hist.current, now = Date.now();
    if (now - h.at > 1000 || !h.past.length) { h.past.push(d); if (h.past.length > 200) h.past.shift(); }
    h.at = now; h.future = [];
    docRef.current = n;
    setDocRaw(n); setDirty(true); setHistTick((x) => x + 1);
  }, []);
  const step = useCallback((dir: "undo" | "redo") => {
    const d = docRef.current, h = hist.current;
    const from = dir === "undo" ? h.past : h.future, to = dir === "undo" ? h.future : h.past;
    if (!d || !from.length) return;
    const n = from.pop()!;
    to.push(d); h.at = 0;
    docRef.current = n;
    setDocRaw(n); setDirty(true); setHistTick((x) => x + 1);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      if ((e.target as HTMLElement | null)?.closest?.("[role=dialog]")) return; // a dialog's own field keeps its own undo
      e.preventDefault(); e.stopPropagation();
      step(k === "y" || e.shiftKey ? "redo" : "undo");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step]);
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const onPage = useCallback((page: BuildDoc["page"]) => setDoc((d) => ({ ...d, page })), [setDoc]);

  // Save a moment after the last change.
  useEffect(() => {
    if (!dirty || !doc) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        if (mode.kind === "build") await saveBuild({ buildId: mode.buildId, title: doc.title, blocks: doc.page, fields: doc.fields, signers: doc.signers, style: doc.style });
        else await updateTemplate({ templateId: mode.templateId, name: meta.name || doc.title, description: meta.description, blocks: doc.page, fields: { project: doc.fields.project, custom: doc.fields.custom }, style: doc.style });
        setDirty(false); setSaveState("saved");
      } catch (e) { setSaveState("error"); show(errText(e)); }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, meta, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fonts: make sure the style's Google fonts are stored, and load every stored face for the screen.
  const fontRows = (fonts ?? []) as FontRow[];
  const families = new Set(fontRows.map((f) => f.family));
  useEffect(() => { void loadForScreen(fontRows); }, [fonts]); // eslint-disable-line react-hooks/exhaustive-deps
  const asking = useRef(new Set<string>());
  useEffect(() => {
    if (!doc || fonts === undefined) return;
    for (const f of [doc.style.fonts.heading, doc.style.fonts.body]) {
      if (f.source !== "google" || families.has(f.family) || asking.current.has(f.family)) continue;
      asking.current.add(f.family);
      ensureGoogle({ family: f.family }).catch((e) => show(errText(e)));
    }
  }, [doc?.style.fonts.heading.family, doc?.style.fonts.body.family, fonts]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileIds = useMemo(() => (doc ? [doc.style.logo?.fileId, doc.style.cover?.fileId, doc.style.backdropImage?.fileId].filter(Boolean) as Id<"_storage">[] : []), [doc?.style.logo?.fileId, doc?.style.cover?.fileId, doc?.style.backdropImage?.fileId]); // eslint-disable-line react-hooks/exhaustive-deps
  const files = useQuery(api.builder.fileUrls, fileIds.length ? { ids: fileIds } : "skip") ?? {};
  // The page is drawn 760px wide, or narrower to fit the space between the outline and the panel (phones too).
  const [stageW, setStageW] = useState(800);
  const ro = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.current.observe(el);
    setStageW(el.clientWidth);
  }, []);
  const onSelectText = useCallback(() => setTab("format"), []);

  const missingKey = doc ? missingFields(doc.page, doc.fields).sort().join(",") : "";
  const missing = useMemo(() => new Set(missingKey ? missingKey.split(",") : []), [missingKey]);

  if (!doc) return <><TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a></TopBar><div className="content"><p className="caption" style={{ padding: 24 }}><Spinner /> Loading…</p></div></>;
  if (mode.kind === "build" && build === null) return <><TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a></TopBar><div className="content"><div className="empty">This document doesn't exist.</div></div></>;

  const st = doc.style;
  const values = fieldValues(doc.fields, doc.page);
  const t = totals(doc.page);
  const pageW = Math.max(300, Math.min(760, stageW - 32)), scale = pageW / PAGE_PT[st.pageSize].w;
  const px = (pt: number) => pt * scale;
  const H = cssFamily(st.fonts.heading.family), B = cssFamily(st.fonts.body.family);
  const sent = mode.kind === "build" && build?.document && (build.document.status === "sent" || build.document.status === "completed");
  const items = editor && !editor.isDestroyed ? outline(editor.state.doc, values, (s, v) => fill(s, v, "…")) : [];

  const onSaveClause = async (sec: PNode) => {
    const c = sectionClause(sec);
    try { await saveClause({ title: c.title, body: c.body, initials: c.initials }); show(`"${c.title}" saved to the clause library`); } catch (e) { show(errText(e)); }
  };
  const dragNodes = (e: React.DragEvent, nodes: PNode[]) => startInsertDrag(e, nodes);

  const assets = () => ({ fonts: fontRows, files: files as Record<string, string | null> });
  const render = async () => { const { renderPdf } = await import("./pdf"); return renderPdf(doc, assets(), build?.document?.label); };
  const onPreview = async () => {
    setBusy("preview");
    try { const blob = await render(); setPreview(URL.createObjectURL(blob)); }
    catch (e) { show(`The PDF couldn't be made: ${errText(e)}`); } finally { setBusy(null); }
  };
  const onContinue = async () => {
    const p = buildProblems(doc);
    if (p.length) { setProblems(p); setTab("details"); return; }
    setBusy("continue");
    try {
      if (dirty && mode.kind === "build") { await saveBuild({ buildId: mode.buildId, title: doc.title, blocks: doc.page, fields: doc.fields, signers: doc.signers, style: doc.style }); setDirty(false); }
      const blob = await render();
      const storageId = await uploadToStorage(await uploadUrl({}), new File([blob], `${doc.title}.pdf`, { type: "application/pdf" }));
      const r = await toSigning({ buildId: (mode as { buildId: Id<"wsBuilds"> }).buildId, storageId });
      navigate(`/sign/d/${r.documentId}`);
    } catch (e) { show(errText(e)); setBusy(null); }
  };
  const onUseTemplate = async () => {
    setBusy("use");
    try { const id = await createBuild({ templateId: (mode as { templateId: Id<"wsTemplates"> }).templateId }); navigate(`/sign/b/${id}`); }
    catch (e) { show(errText(e)); setBusy(null); }
  };
  const goTo = (pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(TextSelection.near(editor.state.doc.resolve(Math.min(pos + 1, editor.state.doc.content.size))).from).run();
    (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const keys = signerKeys(doc.page);
  const extraKeys = keys.filter((k) => k !== "heston" && k !== "client");

  return (
    <BuilderCtx.Provider value={{ doc, values, px, onDetails: () => setTab("details"), onSaveClause: (sec) => void onSaveClause(sec) }}>
      <TopBar right={<>
        <span className="wsb-undo">
          <button className="icon-btn" aria-label="Undo" title={`Undo (${mac ? "⌘Z" : "Ctrl+Z"})`} disabled={!hist.current.past.length} onClick={() => step("undo")}><Undo2 size={16} /></button>
          <button className="icon-btn" aria-label="Redo" title={`Redo (${mac ? "⇧⌘Z" : "Ctrl+Shift+Z"})`} disabled={!hist.current.future.length} onClick={() => step("redo")}><Redo2 size={16} /></button>
        </span>
        <span className={`ws-save hide-sm ${saveState}`}>{saveState === "saving" ? <><Spinner /> Saving</> : saveState === "error" ? <><TriangleAlert size={14} /> Not saved</> : <><Check size={14} /> Saved</>}</span>
        <button className="btn ghost sm hide-sm" onClick={() => void onPreview()} disabled={busy === "preview"}>{busy === "preview" ? <Spinner /> : <Eye size={15} />}Preview PDF</button>
        {mode.kind === "build" ? <>
          <button className="btn ghost sm hide-sm" onClick={() => setAsTemplate(true)}><BookmarkPlus size={15} />Save as template</button>
          <button className="btn primary sm" disabled={busy === "continue" || !!sent} onClick={() => void onContinue()} title={sent ? "It's out for signature or signed" : undefined}>{busy === "continue" ? <Spinner /> : <Send size={15} />}{build?.document ? "Update the PDF" : "Continue to signing"}</button>
        </> : <button className="btn primary sm" disabled={busy === "use"} onClick={() => void onUseTemplate()}>{busy === "use" ? <Spinner /> : <Plus size={15} />}New document from this</button>}
      </>}>
        <FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep />
        {mode.kind === "template" ? <><a {...linkProps("/sign/templates")}>Templates</a><Sep /></> : null}
        <span className="here">{mode.kind === "template" ? meta.name || doc.title : doc.title}{build?.document ? ` · ${build.document.label}` : ""}</span>
      </TopBar>

      <div className="content wsb" style={{ ["--wsb-backdrop" as string]: st.backdrop, ...(st.backdropImage && files[st.backdropImage.fileId] ? { ["--wsb-backdrop-img" as string]: `url(${files[st.backdropImage.fileId]})` } : {}) }}>
        {/* Outline */}
        <nav className="wsb-outline" aria-label="Outline">
          <span className="label">Outline</span>
          {items.map((o) => <button key={o.pos} className={`wsb-oitem${o.level ? " sub" : ""}`} onClick={() => goTo(o.pos)}>{o.text}</button>)}
        </nav>

        {/* The page */}
        <div className="wsb-stage" ref={stageRef}>
          {sent && <div className="ws-banner"><TriangleAlert size={15} /> {build!.document!.label} is {build!.document!.status === "sent" ? "out for signature" : "signed"}. Changes here won't reach it; cancel it first to send a new version.</div>}
          <div className="wsb-page"
            onMouseDown={(e) => {
              // A drag in the page's margin selects whole blocks (like Craft); a click below the text goes to the end.
              if (e.target !== e.currentTarget || !editor) return;
              const r = editor.view.dom.getBoundingClientRect();
              if (e.clientX < r.left) { e.preventDefault(); marginSelect(editor.view, e.clientY, r.left + 8); }
              else if (e.clientY > r.bottom) { e.preventDefault(); editor.chain().focus("end").run(); }
            }}
            style={{ width: pageW, minHeight: px(PAGE_PT[st.pageSize].h), background: st.page, color: st.text, fontFamily: B, fontSize: px(st.baseSize), padding: `${px(st.margin)}px`, ["--wsb-accent" as string]: st.accent, ["--wsb-muted" as string]: st.muted, ["--wsb-heading" as string]: st.heading, ["--wsb-hfont" as string]: H, ["--wsb-bfont" as string]: B, ["--wsb-text" as string]: st.text, ["--wsb-pagebg" as string]: st.page }}>
            {st.cover && files[st.cover.fileId] && <div className="wsb-cover" style={{ height: px(st.cover.height), backgroundImage: `url(${files[st.cover.fileId]})`, margin: `-${px(st.margin)}px -${px(st.margin)}px ${px(18)}px` }} />}
            {st.logo && files[st.logo.fileId] && <div style={{ textAlign: st.logo.align, marginBottom: px(st.baseSize * 1.2) }}><img src={files[st.logo.fileId]!} alt="Logo" style={{ width: px(st.logo.width) }} /></div>}
            <PageEditor page={doc.page} onChange={onPage} onEditor={setEditor} onSelectText={onSelectText} onMenu={setMenu} missing={missing} />
            {st.footer && <div className="wsb-footer" style={{ color: st.muted, fontSize: px(st.baseSize * 0.75) }}><span>{doc.title}</span><span>Page 1 of …</span></div>}
          </div>
        </div>

        {/* The panel */}
        <aside className="wsb-panel">
          <div className="tabs" role="tablist">
            {(["insert", "format", "style", "details"] as Tab[]).map((k) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
          </div>
          {tab === "insert" && (
            <div className="wsb-pane">
              <span className="ws-flabel">Drag onto the page (or into a container), or click to add after the cursor</span>
              {INSERT.map((x) => <button key={x.kind} className="wsb-insert" draggable onDragStart={(e) => dragNodes(e, newNodes(x.kind))} onDragEnd={() => endInsertDrag(editor)} onClick={() => editor && insertKind(editor, x.kind)}>{x.icon}<span><b>{INSERT_LABEL[x.kind]}</b><span className="secondary">{x.hint}</span></span></button>)}
              <ClauseLibrary clauses={clauses} onInsert={(c) => editor && insertNodes(editor, [clauseSection(c)])} onDragStart={(e, c) => dragNodes(e, [clauseSection(c)])} onDragEnd={() => endInsertDrag(editor)} />
            </div>
          )}
          {tab === "format" && <FormatPanel editor={editor} accent={st.accent} onSaveClause={(sec) => void onSaveClause(sec)} />}
          {tab === "style" && <StylePanel style={st} onChange={(s) => setDoc((d) => ({ ...d, style: s }))} fonts={fontRows} files={files as Record<string, string | null>} show={show} />}
          {tab === "details" && (
            <DetailsPane doc={doc} setDoc={setDoc} extraKeys={extraKeys} mode={mode.kind} meta={meta} setMeta={(m) => { setMeta(m); setDirty(true); }} total={t} problems={problems ?? (mode.kind === "build" ? buildProblems(doc) : [])} show={show} />
          )}
        </aside>
      </div>

      {preview && (
        <Modal onClose={() => { URL.revokeObjectURL(preview); setPreview(null); }} label="PDF preview" width={900}>
          <div className="wsb-preview">
            <div className="dhead"><h2 className="headline">Preview <span className="rest">Exactly what will be signed (the signature spots are invisible markers).</span></h2><button className="icon-btn" onClick={() => { URL.revokeObjectURL(preview); setPreview(null); }} aria-label="Close"><X size={18} /></button></div>
            <iframe title="PDF preview" src={preview} />
            <a className="btn ghost sm" href={preview} download={`${doc.title}.pdf`}>Download this preview</a>
          </div>
        </Modal>
      )}
      {asTemplate && <SaveTemplate doc={doc} onClose={() => setAsTemplate(false)} onSave={async (name, description) => {
        try { await saveAsTemplate({ name, description, title: doc.title, blocks: doc.page, fields: doc.fields, signers: [], style: doc.style }); setAsTemplate(false); show(`Saved as the template "${name}"`); } catch (e) { show(errText(e)); }
      }} />}
      {menu && editor && <QuickMenu editor={editor} at={menu} accent={st.accent} onClose={() => setMenu(null)} onMore={() => setTab("format")} onSaveClause={(sec) => void onSaveClause(sec)} />}
      {toast}
    </BuilderCtx.Provider>
  );
}

type LibClause = { _id: string; title: string; body: unknown; initials: boolean };
function ClauseLibrary({ clauses, onInsert, onDragStart, onDragEnd }: { clauses: LibClause[] | undefined; onInsert: (c: LibClause) => void; onDragStart: (e: React.DragEvent, c: LibClause) => void; onDragEnd: () => void }) {
  const [q, setQ] = useState("");
  const list = (clauses ?? []).filter((c) => !q || c.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="wsb-lib">
      <div className="ws-cardhead"><span className="label">Clause library</span><a className="btn ghost sm" {...linkProps("/sign/templates?tab=clauses")}>Manage</a></div>
      <input className="input sm" placeholder="Search clauses" value={q} onChange={(e) => setQ(e.target.value)} />
      {clauses === undefined ? <Spinner /> : list.length === 0 ? <p className="caption secondary">{clauses.length ? "No clause matches." : "No saved clauses yet. Save one from any clause block."}</p>
        : list.map((c) => <button key={c._id} className="wsb-libitem" draggable onDragStart={(e) => onDragStart(e, c)} onDragEnd={onDragEnd} onClick={() => onInsert(c)} title="Drag onto the page, or click to add"><ScrollText size={14} /><span>{c.title}</span>{c.initials && <span className="chip">initials</span>}</button>)}
    </div>
  );
}


function DetailsPane({ doc, setDoc, extraKeys, mode, meta, setMeta, total, problems, show }: {
  doc: BuildDoc; setDoc: (f: (d: BuildDoc) => BuildDoc) => void; extraKeys: string[]; mode: "build" | "template"; meta: Meta; setMeta: (m: Meta) => void;
  total: ReturnType<typeof totals>; problems: string[]; show: (m: string) => void;
}) {
  const saveProfile = useMutation(api.builder.saveProfile);
  const f = doc.fields;
  const setF = (p: Partial<Fields>) => setDoc((d) => ({ ...d, fields: { ...d.fields, ...p } }));
  const setClient = (k: keyof Fields["client"], v: string) => setF({ client: { ...f.client, [k]: v } });
  const setBiz = (k: keyof Fields["business"], v: string) => setF({ business: { ...f.business, [k]: v } });
  const input = (label: string, value: string, on: (v: string) => void, type = "text", ph = "") => <label className="field"><span className="ws-flabel">{label}</span><input className="input sm" type={type} value={value} placeholder={ph} onChange={(e) => on(e.target.value)} /></label>;
  return (
    <div className="wsb-pane">
      {problems.length > 0 && mode === "build" && <ul className="ws-problems">{problems.map((p) => <li key={p}><TriangleAlert size={13} />{p}</li>)}</ul>}
      {mode === "template" ? <>
        {input("Template name", meta.name, (v) => setMeta({ ...meta, name: v }))}
        {input("Description", meta.description, (v) => setMeta({ ...meta, description: v }))}
        <p className="caption secondary">Client details are filled in on each document made from this template.</p>
      </> : <>
        {input("Document title", doc.title, (v) => setDoc((d) => ({ ...d, title: v })))}
        <span className="label">Client</span>
        {input("Name (signs as the client)", f.client.name, (v) => setClient("name", v))}
        {input("Email (the signing link goes here)", f.client.email, (v) => setClient("email", v), "email")}
        {input("Company", f.client.company, (v) => setClient("company", v))}
        {input("Phone", f.client.phone, (v) => setClient("phone", v))}
        {input("Address", f.client.address, (v) => setClient("address", v))}
        {extraKeys.map((k) => {
          const s = doc.signers.find((x) => x.key === k) ?? { key: k, name: "", email: "", title: "" };
          const set = (p: Partial<ExtraSigner>) => setDoc((d) => ({ ...d, signers: [...d.signers.filter((x) => x.key !== k), { ...s, ...p }] }));
          return <div key={k} className="wsb-extra"><span className="label">Client {k.replace("client", "")}</span>{input("Name", s.name, (v) => set({ name: v }))}{input("Email", s.email, (v) => set({ email: v }), "email")}{input("Title or company", s.title, (v) => set({ title: v }))}</div>;
        })}
        {input("Date on the document", f.date, (v) => setF({ date: v }), "date")}
      </>}
      {input("Project", f.project, (v) => setF({ project: v }), "text", "e.g. UTT Flagship Film")}
      <div className="field"><span className="ws-flabel">Custom fields</span>
        {f.custom.map((c, i) => (
          <div key={i} className="wsb-custom">
            <input className="input sm" placeholder="name (e.g. shoot.date)" value={c.key} onChange={(e) => setF({ custom: f.custom.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/[^a-z0-9_.]/gi, "").toLowerCase() } : x)) })} />
            {mode === "build" && <input className="input sm" placeholder="value" value={c.value} onChange={(e) => setF({ custom: f.custom.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
            <button className="icon-btn" aria-label="Remove field" onClick={() => setF({ custom: f.custom.filter((_, j) => j !== i) })}><X size={13} /></button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={() => setF({ custom: [...f.custom, { key: "", label: "", value: "" }] })}><Plus size={13} />Add a field</button>
      </div>
      <div className="field"><span className="ws-flabel">Fill-in fields (click to copy)</span><div className="wsb-fields">
        {[...FIELD_HELP, ...f.custom.filter((c) => c.key).map((c) => ({ key: c.key, label: c.key }))].map((x) => <button key={x.key} className="chip" onClick={() => { void navigator.clipboard.writeText(`{${x.key}}`); show(`Copied {${x.key}}`); }} title={x.label}>{`{${x.key}}`}</button>)}
      </div></div>
      {mode === "build" && <div className="wsb-totals"><span>Total <b>{money(total.total)}</b></span>{total.depositPct > 0 && <span>Deposit <b>{money(total.deposit)}</b>{total.invoiceDeposit ? " → Stripe draft" : ""}</span>}</div>}
      <span className="label">Your business</span>
      {input("Legal name", f.business.legalName, (v) => setBiz("legalName", v))}
      {input("Doing business as", f.business.name, (v) => setBiz("name", v))}
      {input("Contact (signs for the business)", f.business.contact, (v) => setBiz("contact", v))}
      {input("Title", f.business.title, (v) => setBiz("title", v))}
      {input("Email", f.business.email, (v) => setBiz("email", v))}
      {input("Phone", f.business.phone, (v) => setBiz("phone", v))}
      {input("Address", f.business.address, (v) => setBiz("address", v))}
      <button className="btn ghost sm" onClick={async () => { try { await saveProfile({ business: f.business }); show("Saved as your default business details"); } catch (e) { show(errText(e)); } }}><Check size={13} />Use these for new documents</button>
    </div>
  );
}

function SaveTemplate({ doc, onClose, onSave }: { doc: BuildDoc; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState(doc.title);
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Save as template" width={460}>
      <div style={{ display: "grid", gap: 12 }}>
        <h2 className="headline">Save as a template</h2>
        <p className="caption secondary">The page, fields and style are saved; the client's details aren't.</p>
        <label className="field"><span className="ws-flabel">Name</span><input className="input sm" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="ws-flabel">Description (optional)</span><input className="input sm" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); await onSave(name, desc); setBusy(false); }}>{busy ? <Spinner /> : <LayoutTemplate size={15} />}Save template</button></div>
      </div>
    </Modal>
  );
}

