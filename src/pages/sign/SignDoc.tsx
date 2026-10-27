// One Wrangler Sign document (Phase S1, Oct 27): the pages with their boxes, the signers, approve and versions.
// Markers in the PDF ({{sign:client}}, {{initials:client}}, {{date:heston}}, …) place boxes automatically; any box
// can be added, moved, resized, reassigned or deleted by hand. Drafts save as you go. Approving locks the version.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Check, Copy, Crosshair, Eye, FilePlus2, FileSignature, History, Lock, MoreHorizontal, Plus, RefreshCw, ScanSearch, ShieldCheck, ShieldAlert, Trash2, TriangleAlert, UserPlus, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Menu, MenuItem, Modal, Spinner, useToast } from "../../ui/kit";
import { approvalProblems, KINDS, OWNER_KEY, type Kind, type LayoutBox, type LayoutSigner, type Payment, type Rect } from "../../../convex/lib/wsLayout";
import { DEFAULT_SIZE, type ScanResult } from "../../sign/markers";
import { findMarkers, openPdf, renderPage, type PdfDoc } from "../../sign/pdf";
import { central, errText, KIND_LABEL, signerColor, StatusChip, uploadToStorage } from "./common";

type Data = NonNullable<ReturnType<typeof useGetDoc>>;
const useGetDoc = (documentId: Id<"wsDocuments">, versionNumber: number | null) => useQuery(api.sign.get, { documentId, ...(versionNumber ? { versionNumber } : {}) });

type Layout = { title: string; signers: LayoutSigner[]; boxes: LayoutBox[]; signingOrder: "any" | "sequence"; payment: Payment | null };

const OWNER_ALIASES = new Set(["heston", "wrangler", "company", "owner", "me", "provider"]);
const newId = () => `b${Math.random().toString(36).slice(2, 10)}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export default function SignDoc({ documentId, versionNumber }: { documentId: Id<"wsDocuments">; versionNumber: number | null }) {
  const data = useGetDoc(documentId, versionNumber);
  if (data === undefined) return <><TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a></TopBar><div className="content"><p className="caption" style={{ padding: 24 }}>Loading…</p></div></>;
  if (data === null) return <><TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a></TopBar><div className="content"><div className="empty">This document doesn't exist (or was deleted).</div></div></>;
  return <Editor key={data.version._id} data={data} />;
}

function fromServer(d: Data): Layout {
  return { title: d.doc.title, signers: d.version.signers, boxes: d.version.boxes as LayoutBox[], signingOrder: d.version.signingOrder, payment: d.version.payment ?? null };
}

function Editor({ data }: { data: Data }) {
  const { doc, version } = data;
  const editable = version.editable;
  const [layout, setLayoutRaw] = useState<Layout>(() => fromServer(data));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<{ signer: string; kind: Kind } | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [toast, show] = useToast();
  const save = useMutation(api.sign.saveLayout);
  const approve = useMutation(api.sign.approve);
  const revise = useMutation(api.sign.revise);
  const remove = useMutation(api.sign.remove);
  const uploadUrl = useMutation(api.sign.uploadUrl);
  const replaceFile = useAction(api.sign.replaceFile);
  const preview = useAction(api.sign.preview);
  const sig = useQuery(api.sign.ownerSignature);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const hasTextRef = useRef<boolean | undefined>(undefined);

  const setLayout = useCallback((f: (l: Layout) => Layout) => { setLayoutRaw((l) => f(l)); setDirty(true); }, []);

  // Someone else changed it (another tab, or Claude later): take the server's copy when there's nothing unsaved here.
  const serverKey = `${version._id}:${version.updatedAt}:${doc.title}`;
  useEffect(() => { if (!dirty) setLayoutRaw(fromServer(data)); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave drafts, a moment after the last change.
  useEffect(() => {
    if (!dirty || !editable) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      const order = layout.signers.filter((s) => s.key !== OWNER_KEY).map((s) => s.key);
      const signers = layout.signers.map((s) => ({ ...s, order: s.key === OWNER_KEY ? 1 : order.indexOf(s.key) + 1 }));
      try {
        await save({ versionId: version._id, title: layout.title, signers, boxes: layout.boxes, signingOrder: layout.signingOrder, payment: layout.payment, ...(hasTextRef.current !== undefined ? { hasTextLayer: hasTextRef.current } : {}) });
        setDirty(false); setSaveState("saved"); setSaveError(null);
      } catch (e) { setSaveState("error"); setSaveError(errText(e)); }
    }, 650);
    return () => clearTimeout(t);
  }, [layout, dirty, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  // The PDF itself.
  useEffect(() => {
    let dead = false;
    setPdf(null); setPdfError(null);
    if (!version.fileUrl) { setPdfError("The PDF file is missing."); return; }
    openPdf(version.fileUrl).then((d) => { if (!dead) setPdf(d); }, (e) => { if (!dead) setPdfError(String(e?.message ?? e)); });
    return () => { dead = true; };
  }, [version.fileUrl]);

  const runScan = useCallback(async (replace: boolean) => {
    if (!pdf) return;
    setScanning(true);
    try {
      const r = await findMarkers(pdf);
      setScan(r);
      hasTextRef.current = r.textPages > 0;
      setLayout((l) => applyScan(l, r, replace));
    } catch (e) { show(`Couldn't read the PDF's text: ${String((e as Error).message ?? e).slice(0, 120)}`); }
    finally { setScanning(false); }
  }, [pdf, setLayout, show]);

  // First open of a fresh version: find markers once.
  const scannedOnce = useRef(false);
  useEffect(() => {
    if (!pdf || !editable || scannedOnce.current) return;
    scannedOnce.current = true;
    if (version.boxes.length === 0) void runScan(true);
  }, [pdf, editable, version.boxes.length, runScan]);

  const signerKeys = layout.signers.map((s) => s.key);
  const problems = editable ? approvalProblems({ signers: layout.signers, boxes: layout.boxes, pages: version.pages.length, payment: layout.payment, ownerSignatureAdopted: data.owner.adopted }) : [];
  const checkBoxes = scan?.markers.filter((m) => m.check).length ?? 0;

  // Keys: Delete removes the selected box, arrows nudge it (Shift: 10 points), Esc stops placing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "Escape") { setPlacing(null); setSelected(null); return; }
      if (!editable || !selected) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); setLayout((l) => ({ ...l, boxes: l.boxes.filter((b) => b.id !== selected) })); setSelected(null); return; }
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => {
        if (b.id !== selected) return b;
        const p = version.pages[b.page]; const step = e.shiftKey ? 10 : 1;
        return { ...b, x: clamp(b.x + (d[0] * step) / p.width, 0, 1 - b.w), y: clamp(b.y + (d[1] * step) / p.height, 0, 1 - b.h) };
      }) }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable, selected, setLayout, version.pages]);

  const onApprove = async () => {
    setBusy("approve");
    try { const { lockHash } = await approve({ versionId: version._id }); show(`Approved and locked · ${lockHash.slice(0, 10)}…`); }
    catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onPreview = async () => {
    const w = window.open("", "_blank");
    setBusy("preview");
    try { const r = await preview({ versionId: version._id }); if (w) w.location.href = r.url; else window.location.href = r.url; }
    catch (e) { w?.close(); show(errText(e)); } finally { setBusy(null); }
  };
  const onRevise = async () => {
    setBusy("revise");
    try { await revise({ documentId: doc._id }); navigate(`/sign/d/${doc._id}`); show("New version started. The approved one is kept."); }
    catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onReplace = async (f: File) => {
    setBusy("replace");
    try {
      const storageId = await uploadToStorage(await uploadUrl({}), f);
      await replaceFile({ documentId: doc._id, storageId, fileName: f.name });
      navigate(`/sign/d/${doc._id}`);
      show("New version with the new PDF. Earlier versions are kept.");
    } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const onDelete = async () => {
    try { await remove({ documentId: doc._id }); navigate("/sign"); } catch (e) { show(errText(e)); }
  };

  const addBoxAt = (page: number, fx: number, fy: number) => {
    if (!placing) return;
    const p = version.pages[page];
    const size = DEFAULT_SIZE[placing.kind];
    const w = Math.min(size.w / p.width, 0.6), h = Math.min(size.h / p.height, 0.2);
    const box: LayoutBox = { id: newId(), signer: placing.signer, kind: placing.kind, page, x: clamp(fx - w / 2, 0, 1 - w), y: clamp(fy - h / 2, 0, 1 - h), w, h };
    setLayout((l) => ({ ...l, boxes: [...l.boxes, box] }));
    setSelected(box.id);
    setPlacing(null);
  };

  const sel = layout.boxes.find((b) => b.id === selected) ?? null;
  const viewingOld = !version.isCurrent;

  return (
    <>
      <TopBar right={<>
        {editable && <span className={`ws-save ${saveState}`}>{saveState === "saving" ? <><Spinner /> Saving</> : saveState === "error" ? <><TriangleAlert size={14} /> Not saved</> : <><Check size={14} /> Saved</>}</span>}
        <StatusChip status={doc.status} />
        <Menu align="end" label="Document" trigger={(p) => <button {...p} className="icon-btn" aria-label="More"><MoreHorizontal size={18} /></button>}>
          <MenuItem icon={<Eye size={16} />} onSelect={() => void onPreview()}>Preview the PDF</MenuItem>
          {(doc.status === "draft" || doc.status === "approved") && <MenuItem icon={<FilePlus2 size={16} />} onSelect={() => fileInput.current?.click()}>Replace the PDF (new version)…</MenuItem>}
          {(doc.status === "draft" || doc.status === "approved") && <MenuItem icon={<Trash2 size={16} />} danger onSelect={() => setConfirmDelete(true)}>Delete document</MenuItem>}
        </Menu>
      </>}>
        <FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep /><span className="here">{doc.label} · {layout.title}</span>
      </TopBar>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onReplace(f); }} />

      <div className="content ws-doc">
        <div className="ws-pages" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          {viewingOld && <div className="ws-banner"><History size={15} /> You're looking at version {version.number}, an older version. <a {...linkProps(`/sign/d/${doc._id}`)}>Open the current one</a></div>}
          {!editable && version.approvedAt && version.isCurrent && <div className="ws-banner ok"><Lock size={15} /> Version {version.number} is approved and locked. To change anything, make a new version.</div>}
          {placing && <div className="ws-banner place"><Crosshair size={15} /> Click on a page to place the {KIND_LABEL[placing.kind].toLowerCase()} box for {nameOf(layout.signers, placing.signer)}. <button className="btn ghost sm" onClick={() => setPlacing(null)}>Cancel</button></div>}
          {pdfError && <div className="ws-banner bad"><TriangleAlert size={15} /> Couldn't open the PDF: {pdfError}</div>}
          {!pdf && !pdfError && <p className="caption" style={{ padding: 24 }}><Spinner /> Opening the PDF…</p>}
          {pdf && <PagesView pdf={pdf} pages={version.pages} boxes={layout.boxes} signerKeys={signerKeys} signers={layout.signers} editable={editable} selected={selected} placing={!!placing}
            onSelect={setSelected} onPlace={addBoxAt}
            onChange={(id, r) => setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => (b.id === id ? { ...b, ...r } : b)) }))} />}
        </div>

        <aside className="ws-side">
          {/* Status and the main action */}
          <section className="ws-card">
            <div className="ws-cardhead"><span className="label">Version {version.number}{viewingOld ? " (older)" : ""}</span><span className="secondary ws-small">{version.fileName}</span></div>
            {editable ? (
              <>
                {problems.length > 0 ? (
                  <ul className="ws-problems">{problems.map((p) => <li key={p}><TriangleAlert size={13} />{p}</li>)}</ul>
                ) : <p className="caption ws-ready"><Check size={14} /> Ready to approve.</p>}
                {saveError && <p className="caption ws-err">{saveError}</p>}
                <button className="btn primary" disabled={problems.length > 0 || dirty || saveState !== "saved" || busy === "approve"} onClick={() => void onApprove()}>
                  {busy === "approve" ? <Spinner /> : <Lock size={15} />}Approve and lock
                </button>
                <p className="caption secondary">Approving locks this version: the file, the boxes, the signers and the invoice. Sending comes next (Phase S2).</p>
              </>
            ) : version.approvedAt ? (
              <>
                <p className="caption"><Lock size={13} /> Approved {central(version.approvedAt)}</p>
                <HashLine label="Lock hash" value={version.lockHash ?? ""} />
                <HashLine label="File SHA-256" value={version.fileSha256} />
                {version.isCurrent && doc.status === "approved" && <button className="btn" disabled={busy === "revise"} onClick={() => void onRevise()}>{busy === "revise" ? <Spinner /> : <RefreshCw size={15} />}Make changes (new version)</button>}
              </>
            ) : <p className="caption secondary">This version was never approved.</p>}
            <button className="btn ghost sm" onClick={() => void onPreview()} disabled={busy === "preview"}>{busy === "preview" ? <Spinner /> : <Eye size={14} />}Preview the PDF as it will be signed</button>
          </section>

          {/* Details */}
          <section className="ws-card">
            <span className="label">Details</span>
            <label className="field"><span className="ws-flabel">Title</span>
              <input className="input sm" value={layout.title} disabled={!editable} maxLength={120} onChange={(e) => setLayout((l) => ({ ...l, title: e.target.value }))} />
            </label>
            <div className="field"><span className="ws-flabel">Signing order</span>
              <div className="ws-seg">
                <button type="button" className={layout.signingOrder === "any" ? "on" : ""} disabled={!editable} onClick={() => setLayout((l) => ({ ...l, signingOrder: "any" }))}>Any order</button>
                <button type="button" className={layout.signingOrder === "sequence" ? "on" : ""} disabled={!editable} onClick={() => setLayout((l) => ({ ...l, signingOrder: "sequence" }))}>One after another</button>
              </div>
            </div>
            <InvoiceField payment={layout.payment} title={layout.title} editable={editable} onChange={(p) => setLayout((l) => ({ ...l, payment: p }))} />
          </section>

          {/* Signers */}
          <section className="ws-card">
            <div className="ws-cardhead"><span className="label">Signers</span></div>
            <OwnerRow present={signerKeys.includes(OWNER_KEY)} editable={editable} boxes={layout.boxes.filter((b) => b.signer === OWNER_KEY).length} name={sig && sig.adopted ? `${sig.name}, ${sig.title}` : null}
              onToggle={(on) => setLayout((l) => on ? { ...l, signers: [{ key: OWNER_KEY, name: "", email: "", order: 1 }, ...l.signers] } : { ...l, signers: l.signers.filter((s) => s.key !== OWNER_KEY), boxes: l.boxes.filter((b) => b.signer !== OWNER_KEY) })} />
            {layout.signers.filter((s) => s.key !== OWNER_KEY).map((s, i) => (
              <SignerRow key={s.key} s={s} n={i + 1} sequence={layout.signingOrder === "sequence"} color={signerColor(s.key, signerKeys)} editable={editable} boxes={layout.boxes.filter((b) => b.signer === s.key).length}
                onChange={(patch) => setLayout((l) => ({ ...l, signers: l.signers.map((x) => (x.key === s.key ? { ...x, ...patch } : x)) }))}
                onRemove={() => setLayout((l) => ({ ...l, signers: l.signers.filter((x) => x.key !== s.key), boxes: l.boxes.filter((b) => b.signer !== s.key) }))}
                onMove={(dir) => setLayout((l) => {
                  const clients = l.signers.filter((x) => x.key !== OWNER_KEY); const j = clients.findIndex((x) => x.key === s.key); const k = j + dir;
                  if (k < 0 || k >= clients.length) return l;
                  [clients[j], clients[k]] = [clients[k], clients[j]];
                  return { ...l, signers: [...l.signers.filter((x) => x.key === OWNER_KEY), ...clients] };
                })} />
            ))}
            {editable && layout.signers.length < 10 && <button className="btn ghost sm" onClick={() => setLayout((l) => ({ ...l, signers: [...l.signers, { key: nextClientKey(l.signers), name: "", email: "", order: 1 }] }))}><UserPlus size={14} />Add a client signer</button>}
          </section>

          {/* Boxes */}
          <section className="ws-card">
            <div className="ws-cardhead"><span className="label">Boxes</span><span className="secondary ws-small">{layout.boxes.length} on {new Set(layout.boxes.map((b) => b.page)).size} page{new Set(layout.boxes.map((b) => b.page)).size === 1 ? "" : "s"}</span></div>
            {scan && <p className="caption secondary">{scan.textPages === 0 ? "This PDF has no text (a scan?), so markers can't be found. Place the boxes by hand." : scan.markers.length ? `Found ${scan.markers.length} marker${scan.markers.length === 1 ? "" : "s"}.` : "No markers found. Place the boxes by hand, or add markers like {{sign:client}} to the document."}{checkBoxes ? ` ${checkBoxes} sit on sideways text: check where they landed.` : ""}</p>}
            {editable && <AddBox signers={layout.signers} onPlace={(signer, kind) => { setPlacing({ signer, kind }); setSelected(null); }} />}
            {editable && sel && (
              <div className="ws-selbox">
                <span className="ws-flabel">Selected box · page {sel.page + 1}{sel.fromMarker ? " · from a marker" : ""}</span>
                <div className="ws-row2">
                  <select className="input sm" value={sel.signer} onChange={(e) => setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => (b.id === sel.id ? { ...b, signer: e.target.value } : b)) }))}>
                    {layout.signers.map((s) => <option key={s.key} value={s.key}>{nameOf(layout.signers, s.key)}</option>)}
                  </select>
                  <select className="input sm" value={sel.kind} onChange={(e) => setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => (b.id === sel.id ? { ...b, kind: e.target.value as Kind } : b)) }))}>
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </div>
                <button className="btn danger sm" onClick={() => { setLayout((l) => ({ ...l, boxes: l.boxes.filter((b) => b.id !== sel.id) })); setSelected(null); }}><Trash2 size={14} />Delete box</button>
                <span className="caption secondary">Drag to move, drag the corner to resize, arrow keys to nudge.</span>
              </div>
            )}
            {editable && <button className="btn ghost sm" disabled={!pdf || scanning} onClick={() => void runScan(true)}>{scanning ? <Spinner /> : <ScanSearch size={14} />}Find markers again</button>}
            {editable && <p className="caption secondary">Markers: <code>{"{{sign:client}}"}</code> <code>{"{{initials:client}}"}</code> <code>{"{{name:client}}"}</code> <code>{"{{date:client}}"}</code> <code>{"{{title:client}}"}</code>. Use <code>heston</code> for you, and <code>client2</code> … for more signers.</p>}
          </section>

          {/* Versions */}
          <section className="ws-card">
            <span className="label">Versions</span>
            {data.versions.map((x) => (
              <a key={x.number} className={`ws-ver${x.number === version.number ? " on" : ""}`} {...linkProps(x.number === doc.currentVersion ? `/sign/d/${doc._id}` : `/sign/d/${doc._id}?v=${x.number}`)}>
                <b>v{x.number}</b><span className="secondary">{x.approvedAt ? `approved ${central(x.approvedAt)}` : x.number === doc.currentVersion ? "draft" : "never approved"}</span>
                {x.number === doc.currentVersion && <span className="chip fill">current</span>}
              </a>
            ))}
          </section>

          {/* Audit trail */}
          <section className="ws-card">
            <div className="ws-cardhead"><span className="label">Audit trail</span>
              {data.chain.ok ? <span className="ws-chain ok"><ShieldCheck size={14} />Intact · {data.chain.count}</span> : <span className="ws-chain bad"><ShieldAlert size={14} />Broken at {data.chain.atSeq}: {data.chain.reason}</span>}
            </div>
            <ol className="ws-events">
              {[...data.events].reverse().map((e) => (
                <li key={e.seq}><span className="secondary ws-small">{central(e.at)} · {e.actor === OWNER_KEY ? "You" : e.actor}</span><span>{eventLabel(e.kind)}{e.versionNumber ? ` (v${e.versionNumber})` : ""}</span>{e.detail && <span className="secondary ws-small ws-detail">{e.detail}</span>}</li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)} label="Delete document" width={420}>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="headline">Delete {doc.label}?</h2>
            <p className="caption">Every version, the PDF and its trail are removed. It was never sent, so nobody else has it.</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn danger" onClick={() => void onDelete()}><Trash2 size={15} />Delete</button>
            </div>
          </div>
        </Modal>
      )}
      {busy === "replace" && <div className="toast" role="status"><Spinner /> Uploading the new PDF…</div>}
      {toast}
    </>
  );
}

// ---------- markers → layout ----------

function applyScan(l: Layout, r: ScanResult, replace: boolean): Layout {
  const keyOf = (k: string) => (OWNER_ALIASES.has(k) ? OWNER_KEY : k);
  const found = r.markers.map((m, i) => ({ ...m, signer: keyOf(m.signer), i }));
  let signers = [...l.signers];
  for (const k of new Set(found.map((m) => m.signer))) {
    if (signers.some((s) => s.key === k)) continue;
    signers = k === OWNER_KEY ? [{ key: OWNER_KEY, name: "", email: "", order: 1 }, ...signers] : [...signers, { key: k, name: "", email: "", order: 1 }];
  }
  const boxes: LayoutBox[] = found.map((m) => ({ id: `m${m.box.page}-${m.i}`, signer: m.signer, kind: m.kind, page: m.box.page, x: m.box.x, y: m.box.y, w: m.box.w, h: m.box.h, ...(m.check ? {} : { cover: m.cover }), fromMarker: true }));
  const kept = replace ? l.boxes.filter((b) => !b.fromMarker) : l.boxes;
  // The blank "client" a new document starts with goes away if the markers name the signers some other way.
  const used = new Set([...kept, ...boxes].map((b) => b.signer));
  signers = signers.filter((s) => s.key === OWNER_KEY || used.has(s.key) || s.name || s.email);
  if (!signers.some((s) => s.key !== OWNER_KEY)) signers.push({ key: "client", name: "", email: "", order: 1 });
  return { ...l, signers, boxes: [...kept, ...boxes] };
}

function nextClientKey(signers: LayoutSigner[]) {
  const have = new Set(signers.map((s) => s.key));
  if (!have.has("client")) return "client";
  for (let n = 2; ; n++) if (!have.has(`client${n}`)) return `client${n}`;
}

function nameOf(signers: LayoutSigner[], key: string) {
  if (key === OWNER_KEY) return "You";
  const s = signers.find((x) => x.key === key);
  return s?.name ? `${s.name} (${key})` : key;
}

const EVENT_LABEL: Record<string, string> = { created: "Uploaded", approved: "Approved and locked", new_version: "New version", owner_signed: "You signed" };
const eventLabel = (k: string) => EVENT_LABEL[k] ?? k.replace(/_/g, " ");

// ---------- pages and boxes ----------

function PagesView({ pdf, pages, boxes, signers, signerKeys, editable, selected, placing, onSelect, onPlace, onChange }: {
  pdf: PdfDoc; pages: Array<{ width: number; height: number; rotate: number }>; boxes: LayoutBox[]; signers: LayoutSigner[]; signerKeys: string[]; editable: boolean; selected: string | null; placing: boolean;
  onSelect: (id: string | null) => void; onPlace: (page: number, fx: number, fy: number) => void; onChange: (id: string, r: Partial<Rect>) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const on = () => setWidth(Math.min(880, Math.max(240, el.clientWidth - 8)));
    on(); const ro = new ResizeObserver(on); ro.observe(el); return () => ro.disconnect();
  }, []);
  const byPage = useMemo(() => { const m = new Map<number, LayoutBox[]>(); for (const b of boxes) m.set(b.page, [...(m.get(b.page) ?? []), b]); return m; }, [boxes]);
  return (
    <div ref={wrap} className="ws-pagelist">
      {width > 0 && pages.map((p, i) => (
        <PageView key={i} pdf={pdf} index={i} width={width} size={p} boxes={byPage.get(i) ?? []} signers={signers} signerKeys={signerKeys} editable={editable} selected={selected} placing={placing}
          onSelect={onSelect} onPlace={onPlace} onChange={onChange} />
      ))}
    </div>
  );
}

function PageView({ pdf, index, width, size, boxes, signers, signerKeys, editable, selected, placing, onSelect, onPlace, onChange }: {
  pdf: PdfDoc; index: number; width: number; size: { width: number; height: number }; boxes: LayoutBox[]; signers: LayoutSigner[]; signerKeys: string[]; editable: boolean; selected: string | null; placing: boolean;
  onSelect: (id: string | null) => void; onPlace: (page: number, fx: number, fy: number) => void; onChange: (id: string, r: Partial<Rect>) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const height = (width * size.height) / size.width;
  // Draw when the page scrolls near view (long contracts), and again when the width changes.
  useEffect(() => {
    const el = sheet.current; if (!el) return;
    let done = false;
    const io = new IntersectionObserver((es) => {
      if (done || !es.some((e) => e.isIntersecting)) return;
      done = true;
      const t = setTimeout(() => { if (canvas.current) renderPage(pdf, index, canvas.current, width).then(() => setDrawn(true), () => {}); }, 60);
      return () => clearTimeout(t);
    }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [pdf, index, width]);

  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; box: Rect } | null>(null);
  const frac = (e: React.PointerEvent) => { const r = sheet.current!.getBoundingClientRect(); return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }; };

  return (
    <div className="ws-pagewrap">
      <div ref={sheet} className={`ws-sheet${placing ? " placing" : ""}`} style={{ width, height }}
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "CANVAS") { if (placing) { const { fx, fy } = frac(e); onPlace(index, fx, fy); } else onSelect(null); } }}>
        <canvas ref={canvas} aria-label={`Page ${index + 1}`} />
        {!drawn && <span className="ws-pageph"><Spinner /></span>}
        {boxes.map((b) => {
          const color = signerColor(b.signer, signerKeys);
          const s = signers.find((x) => x.key === b.signer);
          const who = b.signer === OWNER_KEY ? "You" : s?.name || b.signer;
          return (
            <div key={b.id} className={`ws-box${selected === b.id ? " sel" : ""}${editable ? " edit" : ""}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, ["--c" as string]: color }}
              title={`${KIND_LABEL[b.kind]} · ${who}`}
              onPointerDown={(e) => {
                e.stopPropagation(); onSelect(b.id);
                if (!editable) return;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                const mode = (e.target as HTMLElement).dataset.handle ? "resize" : "move";
                drag.current = { id: b.id, mode, sx: e.clientX, sy: e.clientY, box: { page: b.page, x: b.x, y: b.y, w: b.w, h: b.h } };
              }}
              onPointerMove={(e) => {
                const d = drag.current; if (!d || d.id !== b.id) return;
                const r = sheet.current!.getBoundingClientRect();
                const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height;
                if (d.mode === "move") onChange(b.id, { x: clamp(d.box.x + dx, 0, 1 - d.box.w), y: clamp(d.box.y + dy, 0, 1 - d.box.h) });
                else onChange(b.id, { w: clamp(d.box.w + dx, 0.01, 1 - d.box.x), h: clamp(d.box.h + dy, 0.006, 1 - d.box.y) });
              }}
              onPointerUp={() => { drag.current = null; }}
              onPointerCancel={() => { drag.current = null; }}>
              <span className="ws-boxlabel">{KIND_LABEL[b.kind]} · {who}</span>
              {editable && <span className="ws-handle" data-handle="1" aria-hidden />}
            </div>
          );
        })}
      </div>
      <span className="ws-pagenum secondary">Page {index + 1}</span>
    </div>
  );
}

// ---------- side-panel pieces ----------

function OwnerRow({ present, editable, boxes, name, onToggle }: { present: boolean; editable: boolean; boxes: number; name: string | null; onToggle: (on: boolean) => void }) {
  return (
    <div className="ws-signer owner" style={{ ["--c" as string]: "var(--accent)" }}>
      <label className="ws-ownertoggle">
        <input type="checkbox" checked={present} disabled={!editable} onChange={(e) => onToggle(e.target.checked)} />
        <span><b>You sign this too</b><br /><span className="secondary ws-small">{name ? `${name} · signed when you send` : <>No signature yet · <a {...linkProps("/sign/signature")}>adopt one</a></>}{present ? ` · ${boxes} box${boxes === 1 ? "" : "es"}` : ""}</span></span>
      </label>
    </div>
  );
}

function SignerRow({ s, n, sequence, color, editable, boxes, onChange, onRemove, onMove }: {
  s: LayoutSigner; n: number; sequence: boolean; color: string; editable: boolean; boxes: number;
  onChange: (p: Partial<LayoutSigner>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="ws-signer" style={{ ["--c" as string]: color }}>
      <div className="ws-signerhead">
        <span className="ws-dot" aria-hidden />
        <span className="mono ws-small">{sequence ? `${n}. ` : ""}{s.key}</span>
        <span className="secondary ws-small">{boxes} box{boxes === 1 ? "" : "es"}</span>
        {editable && <span style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          {sequence && <><button className="icon-btn" aria-label="Sign earlier" onClick={() => onMove(-1)}>↑</button><button className="icon-btn" aria-label="Sign later" onClick={() => onMove(1)}>↓</button></>}
          <button className="icon-btn" aria-label={`Remove ${s.key}`} title={boxes ? "Remove (and its boxes)" : "Remove"} onClick={onRemove}><X size={14} /></button>
        </span>}
      </div>
      <input className="input sm" placeholder="Full name" value={s.name} disabled={!editable} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} />
      <input className="input sm" placeholder="Email" type="email" value={s.email} disabled={!editable} maxLength={200} onChange={(e) => onChange({ email: e.target.value })} />
      <input className="input sm" placeholder="Title (optional, e.g. for a company)" value={s.title ?? ""} disabled={!editable} maxLength={120} onChange={(e) => onChange({ title: e.target.value || undefined })} />
    </div>
  );
}

function AddBox({ signers, onPlace }: { signers: LayoutSigner[]; onPlace: (signer: string, kind: Kind) => void }) {
  const [signer, setSigner] = useState(signers.find((s) => s.key !== OWNER_KEY)?.key ?? signers[0]?.key ?? "client");
  const [kind, setKind] = useState<Kind>("sign");
  useEffect(() => { if (!signers.some((s) => s.key === signer) && signers[0]) setSigner(signers[0].key); }, [signers, signer]);
  return (
    <div className="ws-add">
      <span className="ws-flabel">Add a box</span>
      <div className="ws-row2">
        <select className="input sm" value={signer} onChange={(e) => setSigner(e.target.value)}>{signers.map((s) => <option key={s.key} value={s.key}>{nameOf(signers, s.key)}</option>)}</select>
        <select className="input sm" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
      </div>
      <button className="btn sm" onClick={() => onPlace(signer, kind)} disabled={!signers.length}><Plus size={14} />Place it on a page</button>
    </div>
  );
}

function InvoiceField({ payment, title, editable, onChange }: { payment: Payment | null; title: string; editable: boolean; onChange: (p: Payment | null) => void }) {
  const [amount, setAmount] = useState(payment ? (payment.amountCents / 100).toFixed(2) : "");
  useEffect(() => { setAmount(payment ? (payment.amountCents / 100).toFixed(2) : ""); }, [payment?.amountCents]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (txt: string) => {
    const n = Math.round(Number(txt.replace(/[$,\s]/g, "")) * 100);
    if (payment && Number.isFinite(n) && n !== payment.amountCents) onChange({ ...payment, amountCents: n });
  };
  return (
    <div className="field">
      <label className="ws-ownertoggle">
        <input type="checkbox" checked={!!payment} disabled={!editable} onChange={(e) => onChange(e.target.checked ? { amountCents: 0, description: `Deposit — ${title}`.slice(0, 200) } : null)} />
        <span><b>Draft a Stripe invoice when it's signed</b><br /><span className="secondary ws-small">Created as a draft in Stripe. Nothing is sent until you send it.</span></span>
      </label>
      {payment && (
        <div className="ws-row2">
          <input className="input sm" inputMode="decimal" placeholder="Amount ($)" value={amount} disabled={!editable} onChange={(e) => setAmount(e.target.value)} onBlur={(e) => commit(e.target.value)} aria-label="Invoice amount in dollars" />
          <input className="input sm" placeholder="Description" value={payment.description} disabled={!editable} maxLength={200} onChange={(e) => onChange({ ...payment, description: e.target.value })} aria-label="Invoice description" />
        </div>
      )}
    </div>
  );
}

function HashLine({ label, value }: { label: string; value: string }) {
  const [toast, show] = useToast();
  return (
    <div className="ws-hash">
      <span className="ws-flabel">{label}</span>
      <code className="mono" title={value}>{value.slice(0, 16)}…{value.slice(-8)}</code>
      <button className="icon-btn" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard.writeText(value).then(() => show("Copied")); }}><Copy size={13} /></button>
      {toast}
    </div>
  );
}
