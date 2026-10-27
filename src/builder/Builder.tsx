// The doc builder (B2, Oct 27), laid out like Craft: the outline on the left, the page in the middle (edited where it
// sits), and a panel on the right with Insert · Format · Style · Details. It edits either a build (a document on its
// way to signing) or a template. Everything saves as you go.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, BookmarkPlus, Check, Copy, Eye, FileSignature, GripVertical,
  Heading, LayoutTemplate, List, Minus, PenLine, Plus, Receipt, ScrollText, Send, SeparatorHorizontal, Space, Trash2, TriangleAlert, Type, Upload, Users, X,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Sep, TopBar } from "../shell/Shell";
import { linkProps, navigate } from "../lib/router";
import { Modal, Spinner, useToast } from "../ui/kit";
import {
  BLOCK_LABEL, BUILTIN_FONTS, FIELD_HELP, PAGE_PT, PRESET_STYLES, buildProblems, emptyFields, fieldValues, fill, money, newBlock, newId, rich, signerKeys, totals,
  type Block, type BlockType, type BuildDoc, type ExtraSigner, type Fields, type Fmt, type Rich, type Style, type TextSize,
} from "../../convex/lib/wsBuilder";
import { RichEditor } from "./RichEditor";
import { cssFamily, loadForScreen, type FontRow } from "./fonts";
import { StylePanel } from "./StylePanel";
import { isNoop, place, sameSpot, spotFor, type Drag, type Spot } from "./dnd";
import { errText, uploadToStorage } from "../pages/sign/common";

type Mode = { kind: "build"; buildId: Id<"wsBuilds"> } | { kind: "template"; templateId: Id<"wsTemplates"> };
type Tab = "insert" | "format" | "style" | "details";
type Meta = { name: string; description: string };

const INSERT: Array<{ type: BlockType; icon: React.ReactNode; hint: string }> = [
  { type: "heading", icon: <Heading size={16} />, hint: "A title or section heading" },
  { type: "text", icon: <Type size={16} />, hint: "Paragraphs and lists" },
  { type: "parties", icon: <Users size={16} />, hint: "You and the client" },
  { type: "items", icon: <List size={16} />, hint: "Services with qty, rate, total" },
  { type: "payment", icon: <Receipt size={16} />, hint: "Deposit and balance (sets the Stripe draft)" },
  { type: "clause", icon: <ScrollText size={16} />, hint: "A titled section, optional initials" },
  { type: "signatures", icon: <PenLine size={16} />, hint: "Signature, name, title and date lines" },
  { type: "divider", icon: <Minus size={16} />, hint: "A line between sections" },
  { type: "pagebreak", icon: <SeparatorHorizontal size={16} />, hint: "Start a new page" },
  { type: "spacer", icon: <Space size={16} />, hint: "Some empty space" },
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
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("insert");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [asTemplate, setAsTemplate] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);

  // First load only: after that the page's copy is the truth and saves go up.
  useEffect(() => {
    if (doc) return;
    if (mode.kind === "build" && build) setDocRaw({ title: build.title, blocks: build.blocks as Block[], fields: build.fields as Fields, signers: (build.signers as ExtraSigner[]) ?? [], style: build.style as Style });
    if (mode.kind === "template" && tpl && profile) {
      const f = { ...emptyFields(profile), ...(tpl.fields as Partial<Fields>) } as Fields;
      setDocRaw({ title: tpl.name, blocks: tpl.blocks as Block[], fields: { ...f, business: profile, client: emptyFields(profile).client }, signers: [], style: tpl.style as Style });
      setMeta({ name: tpl.name, description: tpl.description ?? "" });
    }
  }, [build, tpl, profile, doc, mode.kind]);

  const setDoc = useCallback((f: (d: BuildDoc) => BuildDoc) => { setDocRaw((d) => (d ? f(d) : d)); setDirty(true); }, []);
  const setBlock = useCallback((id: string, f: (b: Block) => Block) => setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === id ? f(b) : b)) })), [setDoc]);

  // Save a moment after the last change.
  useEffect(() => {
    if (!dirty || !doc) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        if (mode.kind === "build") await saveBuild({ buildId: mode.buildId, title: doc.title, blocks: doc.blocks, fields: doc.fields, signers: doc.signers, style: doc.style });
        else await updateTemplate({ templateId: mode.templateId, name: meta.name || doc.title, description: meta.description, blocks: doc.blocks, fields: { project: doc.fields.project, custom: doc.fields.custom }, style: doc.style });
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

  if (!doc) return <><TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a></TopBar><div className="content"><p className="caption" style={{ padding: 24 }}><Spinner /> Loading…</p></div></>;
  if (mode.kind === "build" && build === null) return <><TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a></TopBar><div className="content"><div className="empty">This document doesn't exist.</div></div></>;

  const st = doc.style;
  const values = fieldValues(doc.fields, doc.blocks);
  const t = totals(doc.blocks);
  const selected = doc.blocks.find((b) => b.id === sel) ?? null;
  const pageW = Math.max(300, Math.min(760, stageW - 32)), scale = pageW / PAGE_PT[st.pageSize].w;
  const px = (pt: number) => pt * scale;
  const H = cssFamily(st.fonts.heading.family), B = cssFamily(st.fonts.body.family);
  const sent = mode.kind === "build" && build?.document && (build.document.status === "sent" || build.document.status === "completed");

  const insert = (b: Block) => {
    setDoc((d) => {
      const i = sel ? d.blocks.findIndex((x) => x.id === sel) : -1;
      const blocks = [...d.blocks];
      blocks.splice(i >= 0 ? i + 1 : blocks.length, 0, b);
      return { ...d, blocks };
    });
    setSel(b.id);
    setTimeout(() => document.querySelector(`[data-block="${b.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };
  const move = (id: string, dir: -1 | 1) => setDoc((d) => {
    const i = d.blocks.findIndex((b) => b.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= d.blocks.length) return d;
    const blocks = [...d.blocks]; [blocks[i], blocks[j]] = [blocks[j], blocks[i]]; return { ...d, blocks };
  });
  // Drag and drop: a line shows where it will land; dropping moves the block or adds the new one there.
  const endDrag = () => { setDrag(null); setSpot(null); };
  const startDrag = (e: React.DragEvent, d: Drag, image?: Element | null) => {
    setDrag(d);
    e.dataTransfer.effectAllowed = d.kind === "move" ? "move" : "copy";
    // Firefox won't start a drag without data. Our own type, not text: the text editors and fields would paste text.
    e.dataTransfer.setData("application/x-wrangler-block", d.kind === "move" ? d.id : d.label);
    if (image) e.dataTransfer.setDragImage(image, 24, 16);
  };
  const overSpot = (e: React.DragEvent, s: Spot) => {
    if (!drag) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = drag.kind === "move" ? "move" : "copy";
    const next = isNoop(doc?.blocks ?? [], drag, s) ? null : s;
    if (!sameSpot(next, spot)) setSpot(next);
  };
  const drop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (drag && spot) {
      const r = place(doc!.blocks, drag, spot);
      if (r) {
        setDoc((d) => ({ ...d, blocks: r.blocks }));
        setSel(r.id);
        if (drag.kind === "new") setTimeout(() => document.querySelector<HTMLElement>(`[data-block="${r.id}"] input, [data-block="${r.id}"] textarea, [data-block="${r.id}"] [contenteditable]`)?.focus(), 60);
      }
    }
    endDrag();
  };
  const duplicate = (id: string) => setDoc((d) => {
    const i = d.blocks.findIndex((b) => b.id === id);
    const copy = JSON.parse(JSON.stringify(d.blocks[i])) as Block; copy.id = newId();
    const blocks = [...d.blocks]; blocks.splice(i + 1, 0, copy); return { ...d, blocks };
  });
  const remove = (id: string) => { setDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) })); if (sel === id) setSel(null); };

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
      if (dirty && mode.kind === "build") { await saveBuild({ buildId: mode.buildId, title: doc.title, blocks: doc.blocks, fields: doc.fields, signers: doc.signers, style: doc.style }); setDirty(false); }
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

  const keys = signerKeys(doc.blocks);
  const extraKeys = keys.filter((k) => k !== "heston" && k !== "client");

  return (
    <>
      <TopBar right={<>
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
          {doc.blocks.map((b) => (
            <button key={b.id} className={`wsb-oitem${sel === b.id ? " on" : ""}${b.type === "heading" || b.type === "clause" ? "" : " sub"}`} onClick={() => { setSel(b.id); document.querySelector(`[data-block="${b.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
              {outlineText(b, values)}
            </button>
          ))}
        </nav>

        {/* The page */}
        <div className="wsb-stage" ref={stageRef} onClick={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
          {sent && <div className="ws-banner"><TriangleAlert size={15} /> {build!.document!.label} is {build!.document!.status === "sent" ? "out for signature" : "signed"}. Changes here won't reach it; cancel it first to send a new version.</div>}
          <div className={`wsb-page${drag ? " dropping" : ""}${spot?.id === "end" ? " drop-end" : ""}`} onDragOver={(e) => {
            // Over the page but not a block: above the first block means first, anywhere else means last.
            const first = e.currentTarget.querySelector<HTMLElement>("[data-block]");
            overSpot(e, first && e.clientY < first.getBoundingClientRect().top ? { id: first.dataset.block!, after: false } : { id: "end", after: true });
          }} onDrop={drop} style={{ width: pageW, minHeight: px(PAGE_PT[st.pageSize].h), background: st.page, color: st.text, fontFamily: B, fontSize: px(st.baseSize), padding: `${px(st.margin)}px`, ["--wsb-accent" as string]: st.accent, ["--wsb-muted" as string]: st.muted, ["--wsb-heading" as string]: st.heading, ["--wsb-hfont" as string]: H }}>
            {st.cover && files[st.cover.fileId] && <div className="wsb-cover" style={{ height: px(st.cover.height), backgroundImage: `url(${files[st.cover.fileId]})`, margin: `-${px(st.margin)}px -${px(st.margin)}px ${px(18)}px` }} />}
            {st.logo && files[st.logo.fileId] && <div style={{ textAlign: st.logo.align, marginBottom: px(st.baseSize * 1.2) }}><img src={files[st.logo.fileId]!} alt="Logo" style={{ width: px(st.logo.width) }} /></div>}
            {doc.blocks.length === 0 && <p className="wsb-empty" style={{ color: st.muted }}>Drag blocks here from the Insert panel, or click one to add it.</p>}
            {doc.blocks.map((b, i) => (
              <div key={b.id} data-block={b.id} className={`wsb-block${sel === b.id ? " sel" : ""}${drag?.kind === "move" && drag.id === b.id ? " dragging" : ""}${spot?.id === b.id ? (spot.after ? " drop-after" : " drop-before") : ""}`}
                onClick={(e) => { e.stopPropagation(); setSel(b.id); }}
                onDragOver={(e) => overSpot(e, spotFor(b.id, e.currentTarget.getBoundingClientRect(), e.clientY))} onDrop={drop}>
                <div className="wsb-tools" onClick={(e) => e.stopPropagation()}>
                  <span className="wsb-grip" draggable onDragStart={(e) => startDrag(e, { kind: "move", id: b.id }, e.currentTarget.closest(".wsb-block"))} onDragEnd={endDrag} title="Drag to move" aria-label="Drag to move"><GripVertical size={14} /></span>
                  <span className="wsb-kind">{BLOCK_LABEL[b.type]}</span>
                  <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(b.id, -1)}><ArrowUp size={13} /></button>
                  <button className="icon-btn" aria-label="Move down" disabled={i === doc.blocks.length - 1} onClick={() => move(b.id, 1)}><ArrowDown size={13} /></button>
                  <button className="icon-btn" aria-label="Duplicate" onClick={() => duplicate(b.id)}><Copy size={13} /></button>
                  <button className="icon-btn" aria-label="Delete block" onClick={() => remove(b.id)}><Trash2 size={13} /></button>
                </div>
                <BlockEdit b={b} d={doc} values={values} px={px} setBlock={(f) => setBlock(b.id, f)} onDetails={() => setTab("details")}
                  onSaveClause={async (c) => { try { await saveClause({ title: c.title, body: c.rich, initials: c.initials }); show(`"${c.title}" saved to the clause library`); } catch (e) { show(errText(e)); } }} />
              </div>
            ))}
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
              <span className="ws-flabel">Drag onto the page, or click to add after the selected block</span>
              {INSERT.map((x) => <button key={x.type} className="wsb-insert" draggable onDragStart={(e) => startDrag(e, { kind: "new", make: () => newBlock(x.type), label: BLOCK_LABEL[x.type] })} onDragEnd={endDrag} onClick={() => insert(newBlock(x.type))}>{x.icon}<span><b>{BLOCK_LABEL[x.type]}</b><span className="secondary">{x.hint}</span></span></button>)}
              <ClauseLibrary clauses={clauses} onInsert={(c) => insert(clauseBlock(c))} onDragStart={(e, c) => startDrag(e, { kind: "new", make: () => clauseBlock(c), label: c.title })} onDragEnd={endDrag} />
            </div>
          )}
          {tab === "format" && (
            <div className="wsb-pane">
              {!selected ? <p className="caption secondary">Select a block on the page to format it.</p> : <FormatPane b={selected} setBlock={(f) => setBlock(selected.id, f)} accent={st.accent} />}
            </div>
          )}
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
        try { await saveAsTemplate({ name, description, title: doc.title, blocks: doc.blocks, fields: doc.fields, signers: [], style: doc.style }); setAsTemplate(false); show(`Saved as the template "${name}"`); } catch (e) { show(errText(e)); }
      }} />}
      {toast}
    </>
  );
}

function outlineText(b: Block, values: Record<string, string>): string {
  switch (b.type) {
    case "heading": return fill(b.text, values, "…") || "Heading";
    case "clause": return b.title || "Clause";
    case "text": { const first = (b.rich.content?.[0]?.content ?? []).map((n) => n.text ?? "").join(""); return first ? fill(first, values, "…").slice(0, 40) : "Text"; }
    default: return (b as { title?: string }).title || BLOCK_LABEL[b.type];
  }
}

// ---------- blocks, as edited on the page ----------

const SIZE_PX: Record<TextSize, number> = { title: 2.3, subtitle: 1.35, heading: 1.3, strong: 1, body: 1, caption: 0.85 };

function decoStyle(f: Fmt | undefined): React.CSSProperties {
  return {
    textAlign: f?.align, color: !f?.color ? undefined : f.color === "accent" ? "var(--wsb-accent)" : f.color,
    ...(f?.deco === "focus" ? { borderLeft: "2.5px solid var(--wsb-accent)", paddingLeft: 10 } : f?.deco === "block" ? { background: "color-mix(in srgb, var(--wsb-accent) 8%, transparent)", padding: 10, borderRadius: 6 } : {}),
    fontFamily: f?.font === "heading" ? "var(--wsb-hfont)" : undefined,
  };
}

function BlockEdit({ b, d, values, px, setBlock, onDetails, onSaveClause }: { b: Block; d: BuildDoc; values: Record<string, string>; px: (n: number) => number; setBlock: (f: (b: Block) => Block) => void; onDetails: () => void; onSaveClause: (c: Extract<Block, { type: "clause" }>) => void }) {
  const base = d.style.baseSize;
  const title = (text: string | undefined, onChange: (s: string) => void, placeholder = "Section title") => (
    <input className="wsb-title" value={text ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={{ fontSize: px(base * 1.3) }} />
  );
  switch (b.type) {
    case "heading":
      return <textarea className="wsb-heading" rows={1} value={b.text} onChange={(e) => { e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; setBlock((x) => ({ ...(x as typeof b), text: e.target.value })); }}
        style={{ ...decoStyle(b.fmt), fontSize: px(base * SIZE_PX[b.size]), fontWeight: b.size === "subtitle" ? 400 : 700, fontFamily: b.fmt?.font === "body" ? undefined : "var(--wsb-hfont)" }} placeholder="Heading" />;
    case "text":
      return <div style={{ ...decoStyle(b.fmt), fontSize: px(base * SIZE_PX[b.size ?? "body"]), fontWeight: b.size === "strong" ? 700 : undefined, color: b.size === "caption" ? "var(--wsb-muted)" : decoStyle(b.fmt).color }}>
        <RichEditor value={b.rich} onChange={(r) => setBlock((x) => ({ ...(x as typeof b), rich: r }))} placeholder="Type here. Use {client.name}, {project}, {total} … for fill-in fields." />
      </div>;
    case "parties": {
      const f = d.fields;
      return <div style={decoStyle(b.fmt)}>
        {title(b.title, (s) => setBlock((x) => ({ ...(x as typeof b), title: s })))}
        <div className="wsb-parties" onClick={onDetails} title="Edit in Details">
          <div><span className="wsb-cap">Business</span><b>{f.business.legalName}{f.business.name ? `, dba ${f.business.name}` : ""}</b><span>{f.business.contact}</span><span>{f.business.email}</span><span>{f.business.address}</span></div>
          <div><span className="wsb-cap">Client</span><b>{f.client.company || f.client.name || "Client name (Details)"}</b>{f.client.company && <span>{f.client.name}</span>}<span>{f.client.email}</span><span>{f.client.address}</span></div>
        </div>
      </div>;
    }
    case "items": {
      const sum = b.rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.rate) || 0), 0);
      const setRow = (id: string, p: Partial<typeof b.rows[number]>) => setBlock((x) => ({ ...(x as typeof b), rows: (x as typeof b).rows.map((r) => (r.id === id ? { ...r, ...p } : r)) }));
      return <div style={decoStyle(b.fmt)}>
        {title(b.title, (s) => setBlock((x) => ({ ...(x as typeof b), title: s })))}
        <table className="wsb-items">
          <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th><th /></tr></thead>
          <tbody>{b.rows.map((r) => (
            <tr key={r.id}>
              <td><input value={r.description} placeholder="What it is" onChange={(e) => setRow(r.id, { description: e.target.value })} /></td>
              <td><input type="number" min={0} step="any" value={r.qty} onChange={(e) => setRow(r.id, { qty: Number(e.target.value) })} /></td>
              <td><input type="number" min={0} step="any" value={r.rate} onChange={(e) => setRow(r.id, { rate: Number(e.target.value) })} /></td>
              <td className="num">{money((Number(r.qty) || 0) * (Number(r.rate) || 0))}</td>
              <td><button className="icon-btn" aria-label="Remove line" onClick={() => setBlock((x) => ({ ...(x as typeof b), rows: (x as typeof b).rows.filter((y) => y.id !== r.id) }))}><X size={13} /></button></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td><button className="btn ghost sm" onClick={() => setBlock((x) => ({ ...(x as typeof b), rows: [...(x as typeof b).rows, { id: newId(), description: "", qty: 1, rate: 0 }] }))}><Plus size={13} />Add a line</button></td><td /><td className="num"><b>Total</b></td><td className="num"><b>{money(sum)}</b></td><td /></tr></tfoot>
        </table>
      </div>;
    }
    case "payment": {
      const t = totals(d.blocks);
      return <div style={decoStyle(b.fmt)}>
        {title(b.title, (s) => setBlock((x) => ({ ...(x as typeof b), title: s })))}
        <RichEditor value={b.terms} onChange={(r) => setBlock((x) => ({ ...(x as typeof b), terms: r }))} />
        <div className="wsb-pay">
          <label>Deposit <input type="number" min={0} max={100} value={b.depositPct} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), depositPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }))} />%</label>
          <span>Total <b>{money(t.total)}</b></span><span>Deposit <b>{money(t.deposit)}</b></span><span>Balance <b>{money(t.balance)}</b></span>
          <label className="wsb-check"><input type="checkbox" checked={b.invoiceDeposit} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), invoiceDeposit: e.target.checked }))} />Draft a Stripe invoice for the deposit when it's signed</label>
          <label className="wsb-check"><input type="checkbox" checked={!!b.initials} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), initials: e.target.checked }))} />Client initials</label>
        </div>
      </div>;
    }
    case "clause":
      return <div style={decoStyle(b.fmt)}>
        {title(b.title, (s) => setBlock((x) => ({ ...(x as typeof b), title: s })), "Clause title")}
        <RichEditor value={b.rich} onChange={(r) => setBlock((x) => ({ ...(x as typeof b), rich: r }))} placeholder="The clause's wording." />
        <div className="wsb-clausefoot">
          <label className="wsb-check"><input type="checkbox" checked={b.initials} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), initials: e.target.checked }))} />Client initials here</label>
          <button className="btn ghost sm" onClick={() => onSaveClause(b)}><BookmarkPlus size={13} />Save to clause library</button>
        </div>
      </div>;
    case "signatures": {
      const all = ["heston", "client", "client2", "client3", "client4"];
      const name = (k: string) => k === "heston" ? d.fields.business.contact || "You" : k === "client" ? d.fields.client.name || "Client" : d.signers.find((s) => s.key === k)?.name || `Client ${k.replace("client", "")}`;
      return <div style={decoStyle(b.fmt)}>
        {title(b.title, (s) => setBlock((x) => ({ ...(x as typeof b), title: s })))}
        <div className="wsb-sigpick">
          {all.map((k) => <label key={k} className="wsb-check"><input type="checkbox" checked={b.signers.includes(k)} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), signers: e.target.checked ? [...(x as typeof b).signers, k].sort((p, q) => all.indexOf(p) - all.indexOf(q)) : (x as typeof b).signers.filter((y) => y !== k) }))} />{k === "heston" ? "You" : k === "client" ? "Client" : `Client ${k.replace("client", "")}`}</label>)}
          <label className="wsb-check"><input type="checkbox" checked={b.showTitle} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), showTitle: e.target.checked }))} />Title line</label>
          <label className="wsb-check"><input type="checkbox" checked={b.showDate} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), showDate: e.target.checked }))} />Date line</label>
        </div>
        <div className="wsb-sigs">
          {b.signers.map((k) => <div key={k}><span className="wsb-cap">{name(k)}</span><div className="wsb-line tall">Signature</div><div className="wsb-line">Name</div>{b.showTitle && <div className="wsb-line">Title</div>}{b.showDate && <div className="wsb-line">Date</div>}</div>)}
        </div>
      </div>;
    }
    case "divider": return <div className={`wsb-sep ${d.style.separator}`} />;
    case "pagebreak": return <div className="wsb-break"><span>Page break</span></div>;
    case "spacer": return <div style={{ height: px(b.size) }} className="wsb-spacer" />;
  }
}

// ---------- the panel's parts ----------

type LibClause = { _id: string; title: string; body: unknown; initials: boolean };
const clauseBlock = (c: LibClause): Block => ({ id: newId(), type: "clause", title: c.title, rich: c.body as Rich, initials: c.initials, clauseId: c._id });
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

const SWATCHES = ["", "accent", "#1d1d1f", "#6b6862", "#1f3a5f", "#2e6b3f", "#8a3d03", "#7a2a8a"];

function FormatPane({ b, setBlock, accent }: { b: Block; setBlock: (f: (b: Block) => Block) => void; accent: string }) {
  if (b.type === "divider" || b.type === "pagebreak") return <p className="caption secondary">Nothing to format on a {BLOCK_LABEL[b.type].toLowerCase()}. Its look is set in Style (separator).</p>;
  if (b.type === "spacer") return <label className="field"><span className="ws-flabel">Height (pt)</span><input className="input sm" type="number" min={4} max={200} value={b.size} onChange={(e) => setBlock((x) => ({ ...(x as typeof b), size: Math.max(4, Math.min(200, Number(e.target.value) || 12)) }))} /></label>;
  const fmt = (b as { fmt?: Fmt }).fmt ?? {};
  const setFmt = (p: Partial<Fmt>) => setBlock((x) => ({ ...x, fmt: { ...((x as { fmt?: Fmt }).fmt ?? {}), ...p } }) as Block);
  const hasSize = b.type === "heading" || b.type === "text";
  const sizes: TextSize[] = ["title", "subtitle", "heading", "strong", "body", "caption"];
  return (
    <>
      {hasSize && <div className="field"><span className="ws-flabel">Text</span><div className="wsb-grid3">{sizes.map((z) => <button key={z} className={`btn sm ${((b as { size?: TextSize }).size ?? "body") === z ? "primary" : "ghost"}`} onClick={() => setBlock((x) => ({ ...x, size: z }) as Block)}>{z[0].toUpperCase() + z.slice(1)}</button>)}</div></div>}
      <div className="field"><span className="ws-flabel">Alignment</span><div className="ws-seg">
        {([["left", <AlignLeft size={14} key="l" />], ["center", <AlignCenter size={14} key="c" />], ["right", <AlignRight size={14} key="r" />], ["justify", <AlignJustify size={14} key="j" />]] as const).map(([a, ic]) => <button key={a} className={(fmt.align ?? "left") === a ? "on" : ""} onClick={() => setFmt({ align: a })} aria-label={a}>{ic}</button>)}
      </div></div>
      <div className="field"><span className="ws-flabel">Colour</span><div className="wsb-swatches">
        {SWATCHES.map((c) => <button key={c || "default"} className={`wsb-swatch${(fmt.color ?? "") === c ? " on" : ""}`} style={{ background: c === "accent" ? accent : c || "transparent" }} onClick={() => setFmt({ color: c || undefined })} aria-label={c ? `Colour ${c}` : "Default colour"} title={c === "accent" ? "Accent" : c || "Default"}>{!c && "A"}</button>)}
        <input type="color" aria-label="Pick a colour" value={fmt.color && fmt.color.startsWith("#") ? fmt.color : "#000000"} onChange={(e) => setFmt({ color: e.target.value })} />
      </div></div>
      <div className="field"><span className="ws-flabel">Decoration</span><div className="ws-seg">
        {(["none", "focus", "block"] as const).map((x) => <button key={x} className={(fmt.deco ?? "none") === x ? "on" : ""} onClick={() => setFmt({ deco: x })}>{x === "none" ? "None" : x === "focus" ? "Focus line" : "Block"}</button>)}
      </div></div>
      <div className="field"><span className="ws-flabel">Font</span><div className="ws-seg">
        {(["body", "heading"] as const).map((x) => <button key={x} className={(fmt.font ?? (b.type === "heading" ? "heading" : "body")) === x ? "on" : ""} onClick={() => setFmt({ font: x })}>{x === "body" ? "Body font" : "Heading font"}</button>)}
      </div></div>
    </>
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
        <p className="caption secondary">The blocks, fields and style are saved; the client's details aren't.</p>
        <label className="field"><span className="ws-flabel">Name</span><input className="input sm" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="ws-flabel">Description (optional)</span><input className="input sm" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); await onSave(name, desc); setBusy(false); }}>{busy ? <Spinner /> : <LayoutTemplate size={15} />}Save template</button></div>
      </div>
    </Modal>
  );
}

