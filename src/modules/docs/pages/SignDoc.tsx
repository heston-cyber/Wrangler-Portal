// One Wrangler Sign document (Phase S1, Oct 27): the pages with their boxes, the signers, approve and versions.
// Markers in the PDF ({{sign:client}}, {{initials:client}}, {{date:heston}}, …) place boxes automatically; any box
// can be added, moved, resized, reassigned or deleted by hand. Drafts save as you go. Approving locks the version.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps, navigate } from "../../../lib/router";
import { Menu, MenuItem, Modal, Spinner, useToast } from "../../../ui/kit";
import { approvalProblems, KINDS, OWNER_KEY, type Kind, type LayoutBox, type LayoutSigner, type Payment, type Rect } from "../../../../convex/lib/wsLayout";
import { DEFAULT_SIZE, applyScan, type ScanResult } from "../lib/markers";
import { deviceName } from "../../../../convex/lib/wsFinal";
import { findMarkers, openPdf, renderPage, type PdfDoc } from "../lib/pdf";
import { central, errText, KIND_LABEL, signerColor, StatusChip, uploadToStorage } from "./common";
import { Icon } from "../../../ui/Icon";
import { Button, ButtonLink, IconButton, SkeletonRows, StatusChip as Chip, EmptyState } from "../../../ui/wp";

// "Oct 28" (Chicago), with the year when it isn't this year: the short dates on chips. The full time is in the tooltip.
const day = (t: number) => { const tz = "America/Chicago"; const y = (x: number) => new Date(x).toLocaleDateString("en-US", { timeZone: tz, year: "numeric" }); return new Date(t).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", ...(y(t) === y(Date.now()) ? {} : { year: "numeric" }) }); };
import { ClaudeRequests } from "./ClaudeRequests";

type Data = NonNullable<ReturnType<typeof useGetDoc>>;
const useGetDoc = (documentId: Id<"wsDocuments">, versionNumber: number | null) => useQuery(api.sign.get, { documentId, ...(versionNumber ? { versionNumber } : {}) });

type Layout = { title: string; signers: LayoutSigner[]; boxes: LayoutBox[]; signingOrder: "any" | "sequence"; payment: Payment | null };

const newId = () => `b${Math.random().toString(36).slice(2, 10)}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export default function SignDoc({ documentId, versionNumber }: { documentId: Id<"wsDocuments">; versionNumber: number | null }) {
  const data = useGetDoc(documentId, versionNumber);
  if (data === undefined) return <><TopBar><a {...linkProps("/sign")}>Docs</a></TopBar><div className="wp-page docs"><div className="wp-tablecard glass"><SkeletonRows n={3} /></div></div></>;
  if (data === null) return <><TopBar><a {...linkProps("/sign")}>Docs</a></TopBar><div className="wp-page docs"><EmptyState icon="document" title="This document doesn't exist (or was deleted)." actions={<ButtonLink to="/sign/docs">All docs</ButtonLink>} /></div></>;
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
  // ?send=1 (from the Docs right-click menu) opens the send dialog straight away; the address is tidied after.
  const [sending, setSending] = useState(() => new URLSearchParams(location.search).get("send") === "1" && doc.status === "approved" && version.isCurrent);
  useEffect(() => { if (new URLSearchParams(location.search).has("send")) history.replaceState(null, "", location.pathname); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fileInput = useRef<HTMLInputElement>(null);
  const hasTextRef = useRef<boolean | undefined>(undefined);
  // S3: once everyone has signed, the page shows the signed copy (with its certificate pages); the original with its
  // boxes is one click away.
  const signedAvailable = !!data.finalUrl && version.isCurrent && doc.sentVersion === version.number;
  const [showOriginal, setShowOriginal] = useState(false);
  const showSigned = signedAvailable && !showOriginal;
  const src = showSigned ? data.finalUrl : version.fileUrl;
  const [signedPages, setSignedPages] = useState<Array<{ width: number; height: number; rotate: number }> | null>(null);

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
    if (!src) { setPdfError("The PDF file is missing."); return; }
    openPdf(src).then(async (d) => {
      if (showSigned) {
        const sizes = [];
        for (let i = 1; i <= d.numPages; i++) { const vp = (await d.getPage(i)).getViewport({ scale: 1 }); sizes.push({ width: vp.width, height: vp.height, rotate: 0 }); }
        if (!dead) setSignedPages(sizes);
      }
      if (!dead) setPdf(d);
    }, (e) => { if (!dead) setPdfError(String(e?.message ?? e)); });
    return () => { dead = true; };
  }, [src?.split("?")[0], showSigned]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {editable && <span className={`ws-save ${saveState}`}>{saveState === "saving" ? <><Spinner /> Saving</> : saveState === "error" ? <><Icon name="alert" size={14} /> Not saved</> : <><Icon name="check" size={14} plain /> Saved</>}</span>}
        {doc.buildId && doc.status !== "sent" && doc.status !== "completed" && <ButtonLink variant="ghost" size="sm" className="hide-sm" to={`/sign/b/${doc.buildId}`}>Edit in builder</ButtonLink>}
        <StatusChip status={doc.status} />
        <Menu align="end" label="Document" trigger={(p) => <button {...p} className="icon-btn sm" aria-label="More"><Icon name="more" size={18} /></button>}>
          <MenuItem icon={<Icon name="eye" size={16} />} onSelect={() => void onPreview()}>Preview the PDF</MenuItem>
          {(doc.status === "draft" || doc.status === "approved") && <MenuItem icon={<Icon name="upload" size={16} />} onSelect={() => fileInput.current?.click()}>Replace the PDF (new version)…</MenuItem>}
          {(doc.status === "draft" || doc.status === "approved") && <MenuItem icon={<Icon name="close" size={16} />} danger onSelect={() => setConfirmDelete(true)}>Delete document</MenuItem>}
        </Menu>
      </>}>
        <a {...linkProps("/sign")}>Docs</a><Sep /><span className="here">{doc.label} · {layout.title}</span>
      </TopBar>
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onReplace(f); }} />

      <div className="content ws-doc">
        <div className="ws-pages" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <ClaudeRequests documentId={doc._id} label={doc.label} />
          {viewingOld && <div className="wp-notice ws-banner"><Icon name="clock" size={20} /><span className="txt">You're looking at version {version.number}, an older version.</span><ButtonLink size="sm" to={`/sign/d/${doc._id}`}>Open the current one</ButtonLink></div>}
          {!editable && version.approvedAt && version.isCurrent && !signedAvailable && <div className="wp-notice ws-banner"><Icon name="lock" size={20} /><span className="txt">{doc.status === "sent" ? `Version ${version.number} is out for signature. To change anything, cancel signing, then make a new version.` : doc.status === "completed" ? `Version ${version.number} is signed by everyone.` : `Version ${version.number} is approved and locked. To change anything, make a new version.`}</span></div>}
          {placing && <div className="wp-notice ws-banner"><Icon name="info" size={20} /><span className="txt">Click on a page to place the {KIND_LABEL[placing.kind].toLowerCase()} box for {nameOf(layout.signers, placing.signer)}.</span><Button size="sm" onClick={() => setPlacing(null)}>Cancel</Button></div>}
          {pdfError && <div className="wp-notice ws-banner"><Icon name="alert" size={20} /><span className="txt">Couldn't open the PDF: {pdfError}</span></div>}
          {!pdf && !pdfError && <p className="wp-small ws-opening"><Spinner /> Opening the PDF…</p>}
          {signedAvailable && <div className="wp-notice ws-banner"><Icon name="check-circle" size={20} /><span className="txt">{showSigned ? "You're looking at the signed copy, with its certificate at the end." : "You're looking at the original with its boxes."}</span><Button size="sm" onClick={() => { setPdf(null); setShowOriginal(!showOriginal); }}>{showSigned ? "Show the original" : "Show the signed copy"}</Button></div>}
          {pdf && (!showSigned || signedPages) && <PagesView pdf={pdf} pages={showSigned ? signedPages! : version.pages} boxes={showSigned ? [] : layout.boxes} signerKeys={signerKeys} signers={layout.signers} editable={editable} selected={selected} placing={!!placing}
            onSelect={setSelected} onPlace={addBoxAt}
            onChange={(id, r) => setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => (b.id === id ? { ...b, ...r } : b)) }))} />}
        </div>

        <aside className="ws-side">
          {/* Status and the main action */}
          <section className="ws-card glass">
            <span className="label">Version {version.number}{viewingOld ? " (older)" : ""}</span><span className="ws-file">{version.fileName}</span>
            {editable ? (
              <>
                {problems.length > 0 ? (
                  <ul className="ws-problems">{problems.map((p) => <li key={p}><Icon name="alert" size={16} />{p}</li>)}</ul>
                ) : <p className="ws-ready"><Icon name="check-circle" size={16} plain /> Ready to approve.</p>}
                {saveError && <p className="caption ws-err">{saveError}</p>}
                <div><Button variant="primary" loading={busy === "approve"} disabled={problems.length > 0 || dirty || saveState !== "saved"} onClick={() => void onApprove()}>Approve and lock</Button></div>
                <p className="wp-small ws-hint">Approving locks this version: the file, the boxes, the signers and the invoice. Then you send it.</p>
              </>
            ) : version.approvedAt ? (
              <>
                <p className="ws-line"><Icon name="lock" size={16} /> Approved {central(version.approvedAt)}</p>
                <HashLine label="Lock hash" value={version.lockHash ?? ""} />
                <HashLine label="File SHA-256" value={version.fileSha256} />
                {version.isCurrent && doc.status === "approved" && <div><Button variant="primary" icon="send" onClick={() => setSending(true)}>Send for signature…</Button></div>}
                {version.isCurrent && (doc.status === "approved" || doc.status === "voided") && <div><Button loading={busy === "revise"} onClick={() => void onRevise()}>Make changes (new version)</Button></div>}
              </>
            ) : <p className="wp-small ws-hint">This version was never approved.</p>}
            <div><Button variant="ghost" size="sm" loading={busy === "preview"} onClick={() => void onPreview()} iconEnd="external">Preview the PDF as it will be signed</Button></div>
          </section>

          {doc.status === "completed" && <FinishedCard data={data} show={show} />}
          {data.signings.length > 0 && <SigningCard data={data} show={show} />}

          {/* Details */}
          <section className="ws-card glass">
            <span className="label">Details</span>
            <label className="wp-field"><span className="wp-field-label">Title</span>
              <input className="input" value={layout.title} disabled={!editable} maxLength={120} onChange={(e) => setLayout((l) => ({ ...l, title: e.target.value }))} />
            </label>
            <div className="wp-field ws-orderrow"><span className="wp-field-label">Signing order</span>
              <div className="wp-seg">
                <button type="button" aria-pressed={layout.signingOrder === "any"} className={layout.signingOrder === "any" ? "on" : ""} disabled={!editable} onClick={() => setLayout((l) => ({ ...l, signingOrder: "any" }))}>Any order</button>
                <button type="button" aria-pressed={layout.signingOrder === "sequence"} className={layout.signingOrder === "sequence" ? "on" : ""} disabled={!editable} onClick={() => setLayout((l) => ({ ...l, signingOrder: "sequence" }))}>One after another</button>
              </div>
            </div>
            <InvoiceField payment={layout.payment} title={layout.title} editable={editable} onChange={(p) => setLayout((l) => ({ ...l, payment: p }))} />
          </section>

          {/* Signers */}
          <section className="ws-card glass">
            <span className="label">Signers</span>
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
            {editable && layout.signers.length < 10 && <div><Button variant="ghost" size="sm" onClick={() => setLayout((l) => ({ ...l, signers: [...l.signers, { key: nextClientKey(l.signers), name: "", email: "", order: 1 }] }))} icon="plus">Add a client signer</Button></div>}
          </section>

          {/* Boxes */}
          <section className="ws-card glass">
            <span className="label">Boxes · {layout.boxes.length} on {new Set(layout.boxes.map((b) => b.page)).size} page{new Set(layout.boxes.map((b) => b.page)).size === 1 ? "" : "s"}</span>
            {scan && <p className="wp-small ws-hint">{scan.textPages === 0 ? "This PDF has no text (a scan?), so markers can't be found. Place the boxes by hand." : scan.markers.length ? `Found ${scan.markers.length} marker${scan.markers.length === 1 ? "" : "s"}.` : "No markers found. Place the boxes by hand, or add markers like {{sign:client}} to the document."}{checkBoxes ? ` ${checkBoxes} sit on sideways text: check where they landed.` : ""}</p>}
            {editable && <AddBox signers={layout.signers} onPlace={(signer, kind) => { setPlacing({ signer, kind }); setSelected(null); }} />}
            {editable && sel && (
              <div className="ws-selbox">
                <span className="ws-sublabel">Selected box · page {sel.page + 1}{sel.fromMarker ? " · from a marker" : ""}</span>
                <div className="ws-row2">
                  <select className="input" value={sel.signer} onChange={(e) => setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => (b.id === sel.id ? { ...b, signer: e.target.value } : b)) }))}>
                    {layout.signers.map((s) => <option key={s.key} value={s.key}>{nameOf(layout.signers, s.key)}</option>)}
                  </select>
                  <select className="input" value={sel.kind} onChange={(e) => setLayout((l) => ({ ...l, boxes: l.boxes.map((b) => (b.id === sel.id ? { ...b, kind: e.target.value as Kind } : b)) }))}>
                    {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select>
                </div>
                <div><Button size="sm" onClick={() => { setLayout((l) => ({ ...l, boxes: l.boxes.filter((b) => b.id !== sel.id) })); setSelected(null); }}>Delete box</Button></div>
                <span className="wp-small ws-hint">Drag to move, drag the corner to resize, arrow keys to nudge.</span>
              </div>
            )}
            {editable && <div><Button variant="ghost" size="sm" loading={scanning} disabled={!pdf} onClick={() => void runScan(true)} iconEnd="chevron-right">Find markers again</Button></div>}
            {editable && <p className="wp-small ws-hint">Markers: <code>{"{{sign:client}}"}</code> <code>{"{{initials:client}}"}</code> <code>{"{{name:client}}"}</code> <code>{"{{date:client}}"}</code> <code>{"{{title:client}}"}</code>. Use <code>heston</code> for you, and <code>client2</code> … for more signers.</p>}
          </section>

          {/* Versions */}
          <section className="ws-card glass">
            <span className="label">Versions</span>
            {data.versions.map((x) => (
              <a key={x.number} className={`ws-ver${x.number === version.number ? " on" : ""}`} {...linkProps(x.number === doc.currentVersion ? `/sign/d/${doc._id}` : `/sign/d/${doc._id}?v=${x.number}`)}>
                <b>v{x.number}</b><span className="secondary" title={x.approvedAt ? central(x.approvedAt) : undefined}>{x.approvedAt ? `approved ${day(x.approvedAt)}` : x.number === doc.currentVersion ? "draft" : "never approved"}</span>
                {x.number === doc.currentVersion && <Chip>Current</Chip>}
              </a>
            ))}
          </section>

          {/* Audit trail */}
          <section className="ws-card glass">
            <span className="label">Audit trail</span>
            {data.chain.ok ? <span className="ws-chain"><Icon name="lock" size={16} />Intact · {data.chain.count}<Chip tone="success">Intact</Chip></span> : <span className="ws-chain bad"><Icon name="alert" size={16} />Broken at {data.chain.atSeq}: {data.chain.reason}</span>}
            <ol className="ws-events">
              {[...data.events].reverse().map((e) => (
                <li key={e.seq}><span className="when">{central(e.at)} · {e.actor === OWNER_KEY ? "You" : e.actor}</span><span className="what">{eventLabel(e.kind)}{e.versionNumber ? ` (v${e.versionNumber})` : ""}</span>{e.detail && <span className="secondary ws-small ws-detail">{e.detail}</span>}{(e.ip || e.userAgent) && <span className="secondary ws-small ws-detail" title={e.userAgent ?? undefined}>{[e.ip ? `IP ${e.ip}` : null, device(e.userAgent)].filter(Boolean).join(" · ")}</span>}</li>
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
              <button className="btn danger" onClick={() => void onDelete()}>Delete</button>
            </div>
          </div>
        </Modal>
      )}
      {sending && <SendDialog data={data} onClose={() => setSending(false)} onSent={(n) => { setSending(false); show(`Sent to ${n} signer${n === 1 ? "" : "s"}. You'll get an email as each one signs.`); }} />}
      {busy === "replace" && <div className="toast" role="status"><Spinner /> Uploading the new PDF…</div>}
      {toast}
    </>
  );
}

// ---------- markers → layout ----------

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

const EVENT_LABEL: Record<string, string> = {
  created: "Uploaded", approved: "Approved and locked", new_version: "New version", owner_signed: "You signed",
  sent: "Link emailed", send_settings: "Sent for signature", email_bounced: "Email failed", reminder_sent: "Reminder emailed", voided: "Cancelled", expiry_changed: "Expiry changed",
  opened: "Opened the link", code_sent: "Code emailed", code_failed: "Wrong code", email_verified: "Email confirmed", consent_given: "Agreed to sign electronically",
  page_viewed: "Viewed a page", signature_adopted: "Adopted a signature", signature_changed: "Changed their signature", initialed: "Initialed", initials_removed: "Took initials off",
  signed: "Signed", all_signed: "Everyone signed", email_delivered_to_resend: "Email sent", email_failed: "Email failed",
  signed_copy_made: "Signed copy made", invoice_drafted: "Stripe draft invoice", copy_emailed: "Signed copy emailed", copy_failed: "Copy email failed", archived: "Archived to Dropbox",
  pdf_failed: "Signed copy failed", invoice_failed: "Stripe draft failed", copies_failed: "Copies failed", archive_failed: "Archive failed",
};
const device = deviceName;
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
        <span><b>You sign this too</b><br /><span className="ws-sub">{name ? `${name} · signed when you send` : <>No signature yet · <a {...linkProps("/sign/signature")}>adopt one</a></>}{present ? ` · ${boxes} box${boxes === 1 ? "" : "es"}` : ""}</span></span>
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
        <span className="key">{sequence ? `${n}. ` : ""}{s.key}</span>
        <span className="sp" />
        <span className="ws-sub">{boxes} box{boxes === 1 ? "" : "es"}</span>
        {editable && <span style={{ display: "flex", gap: 2 }}>
          {sequence && <><IconButton icon="arrow-up" label="Sign earlier" bare className="sm" iconSize={16} onClick={() => onMove(-1)} /><IconButton icon="arrow-down" label="Sign later" bare className="sm" iconSize={16} onClick={() => onMove(1)} /></>}
          <IconButton icon="close" label={`Remove ${s.key}`} title={boxes ? "Remove (and its boxes)" : "Remove"} bare className="sm" iconSize={16} onClick={onRemove} />
        </span>}
      </div>
      <label className="wp-field"><span className="wp-field-label">Full name</span><input className="input" placeholder="Full name" value={s.name} disabled={!editable} maxLength={120} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <label className="wp-field"><span className="wp-field-label">Email</span><input className="input" placeholder="Email" type="email" value={s.email} disabled={!editable} maxLength={200} onChange={(e) => onChange({ email: e.target.value })} /></label>
      <label className="wp-field"><span className="wp-field-label">Title (optional, e.g. for a company)</span><input className="input" value={s.title ?? ""} disabled={!editable} maxLength={120} onChange={(e) => onChange({ title: e.target.value || undefined })} /></label>
    </div>
  );
}

function AddBox({ signers, onPlace }: { signers: LayoutSigner[]; onPlace: (signer: string, kind: Kind) => void }) {
  const [signer, setSigner] = useState(signers.find((s) => s.key !== OWNER_KEY)?.key ?? signers[0]?.key ?? "client");
  const [kind, setKind] = useState<Kind>("sign");
  useEffect(() => { if (!signers.some((s) => s.key === signer) && signers[0]) setSigner(signers[0].key); }, [signers, signer]);
  return (
    <div className="ws-add">
      <div className="ws-row2">
        <select className="input" aria-label="Who signs it" value={signer} onChange={(e) => setSigner(e.target.value)}>{signers.map((s) => <option key={s.key} value={s.key}>{nameOf(signers, s.key)}</option>)}</select>
        <select className="input" aria-label="What kind of box" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
      </div>
      <div><Button size="sm" onClick={() => onPlace(signer, kind)} disabled={!signers.length}>Place it on a page</Button></div>
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
    <div className="ws-invoice">
      <label className="ws-ownertoggle">
        <input type="checkbox" checked={!!payment} disabled={!editable} onChange={(e) => onChange(e.target.checked ? { amountCents: 0, description: `Deposit — ${title}`.slice(0, 200) } : null)} />
        <span><b>Draft a Stripe invoice when it's signed</b><br /><span className="ws-sub">Created as a draft in Stripe. Nothing is sent until you send it.</span></span>
      </label>
      {payment && (
        <div className="ws-row2">
          <label className="wp-field"><span className="wp-field-label">Amount ($)</span><input className="input" inputMode="decimal" placeholder="Amount ($)" value={amount} disabled={!editable} onChange={(e) => setAmount(e.target.value)} onBlur={(e) => commit(e.target.value)} aria-label="Invoice amount in dollars" /></label>
          <label className="wp-field"><span className="wp-field-label">Description</span><input className="input" placeholder="Description" value={payment.description} disabled={!editable} maxLength={200} onChange={(e) => onChange({ ...payment, description: e.target.value })} aria-label="Invoice description" /></label>
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
      <IconButton icon="document" label={`Copy ${label}`} bare className="sm" iconSize={16} onClick={() => { void navigator.clipboard.writeText(value).then(() => show("Copied")); }} />
      {toast}
    </div>
  );
}

// ---------- sending (S2) ----------

type SendData = Data;

function SendDialog({ data, onClose, onSent }: { data: SendData; onClose: () => void; onSent: (n: number) => void }) {
  const send = useMutation(api.sign.send);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const v = data.version;
  const clients = v.signers.filter((s) => s.key !== OWNER_KEY).sort((a, b) => a.order - b.order);
  const ownerSigns = v.signers.some((s) => s.key === OWNER_KEY);
  const until = new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await send({ versionId: v._id, expiresInDays: days }); onSent(r.sent); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal onClose={onClose} label="Send for signature" width={480}>
      <div style={{ display: "grid", gap: 12 }}>
        <h2 className="headline">Send {data.doc.label} for signature?</h2>
        <ol className="ws-sendlist">
          {clients.map((c, i) => (
            <li key={c.key}><span className="ws-dot" style={{ ["--c" as string]: signerColor(c.key, v.signers.map((x) => x.key)) }} /><span><b>{c.name}</b>{c.title ? `, ${c.title}` : ""}<br /><span className="secondary ws-small">{c.email}</span></span>
              <span className="secondary ws-small" style={{ marginLeft: "auto" }}>{v.signingOrder === "sequence" ? (i === 0 ? "gets it now" : `after ${clients[i - 1].name.split(" ")[0]}`) : "gets it now"}</span></li>
          ))}
        </ol>
        {ownerSigns && <p className="caption"><Icon name="sign" size={14} /> Your adopted signature goes on your boxes now, dated today.</p>}
        <label className="field"><span className="ws-flabel">Links work for</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}><input className="input sm" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} style={{ width: 80 }} /><span className="caption secondary">days, until {until}</span></span>
        </label>
        <p className="caption secondary">Each signer gets an email from contracts@wranglerportal.com with their own link. They confirm their email with a code, agree to sign electronically, then sign. Replies come to you.</p>
        {err && <p className="caption ws-err"><Icon name="alert" size={14} /> {err}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <Button variant="primary" icon="send" loading={busy} onClick={() => void go()}>Sign and send</Button>
        </div>
      </div>
    </Modal>
  );
}

type Tone = "accent" | "success" | "neutral" | "danger";
function signingStep(x: Data["signings"][number], now: number): { text: string; tone: Tone; at?: number } {
  if (x.status === "signed") return { text: `Signed ${day(x.signedAt!)}`, tone: "success", at: x.signedAt! };
  if (x.status === "closed") return { text: "Link cancelled", tone: "danger" };
  if (x.status === "waiting") return { text: "Waiting for their turn", tone: "neutral" };
  if (x.lockedUntil && x.lockedUntil > now) return { text: "Locked: too many wrong codes", tone: "danger" };
  if (x.consentAt) return { text: "Agreed, signing", tone: "accent" };
  if (x.verifiedAt) return { text: "Confirmed their email", tone: "accent" };
  if (x.openedAt) return { text: `Opened ${day(x.openedAt)}`, tone: "accent", at: x.openedAt };
  const at = x.lastEmailAt ?? x.sentAt ?? now;
  return { text: `Emailed ${day(at)}`, tone: "accent", at };
}

function SigningCard({ data, show }: { data: Data; show: (m: string) => void }) {
  const { doc } = data;
  const resend = useMutation(api.sign.resend);
  const extend = useMutation(api.sign.extendExpiry);
  const voidDoc = useMutation(api.sign.voidDocument);
  const [busy, setBusy] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [extending, setExtending] = useState(false);
  const [days, setDays] = useState(14);
  const now = Date.now();
  const live = doc.status === "sent";
  const expired = live && !!doc.expiresAt && doc.expiresAt < now;
  const copy = async (link: string) => { try { await navigator.clipboard.writeText(link); show("Link copied. It only works for that signer, after they confirm their email."); } catch { show(link); } };
  const run = async (key: string, f: () => Promise<unknown>, ok: string) => { setBusy(key); try { await f(); show(ok); } catch (e) { show(errText(e)); } finally { setBusy(null); } };
  return (
    <section className="ws-card glass">
      <span className="label">Signing · v{doc.sentVersion}{doc.status === "completed" && doc.completedAt ? ` · done ${day(doc.completedAt)}` : doc.status === "voided" ? " · cancelled" : expired ? " · expired" : doc.expiresAt ? ` · until ${new Date(doc.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
      {doc.status === "voided" && <p className="caption ws-err"><Icon name="alert" size={14} /> Cancelled {doc.voidedAt ? central(doc.voidedAt) : ""}{doc.voidReason ? `: ${doc.voidReason}` : "."} Make a new version to send it again.</p>}
      {expired && <p className="caption ws-err"><Icon name="calendar" size={14} /> The links have expired. Extend them to let signers finish.</p>}
      {data.signings.map((x) => {
        const st = signingStep(x, now);
        return (
          <div key={x.key} className="ws-signing">
            <div className="ws-signerhead"><b>{x.name}</b><span title={st.at ? central(st.at) : undefined}><Chip tone={st.tone}>{st.text}</Chip></span></div>
            {doc.status !== "completed" && <span className="ws-sub">{x.email}</span>}
            {live && x.status === "sent" && (
              <div className="ws-btnrow">
                <Button size="sm" onClick={() => void copy(x.link)}>Copy link</Button>
                <Button size="sm" loading={busy === x.key} onClick={() => void run(x.key, () => resend({ documentId: doc._id, signerKey: x.key }), `Reminder sent to ${x.name}.`)}>Send reminder</Button>
              </div>
            )}
          </div>
        );
      })}
      {live && (
        <div className="ws-btnrow end">
          <Button variant="ghost" size="sm" onClick={() => setExtending(true)}>{expired ? "Extend the links" : "Change expiry"}</Button>
          <span className="sp" />
          <Button size="sm" onClick={() => setVoiding(true)}>Cancel signing…</Button>
        </div>
      )}
      {extending && (
        <Modal onClose={() => setExtending(false)} label="Change expiry" width={380}>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="headline">Links work for</h2>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}><input className="input sm" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} style={{ width: 80 }} /><span className="caption secondary">more days from today</span></span>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setExtending(false)}>Cancel</button>
              <button className="btn primary" disabled={busy === "extend"} onClick={() => void run("extend", async () => { await extend({ documentId: doc._id, days }); setExtending(false); }, "Expiry changed.")}>Save</button>
            </div>
          </div>
        </Modal>
      )}
      {voiding && (
        <Modal onClose={() => setVoiding(false)} label="Cancel signing" width={440}>
          <div style={{ display: "grid", gap: 12 }}>
            <h2 className="headline">Cancel {doc.label}?</h2>
            <p className="caption">Every signing link stops working now, and anyone who got one is emailed that it was cancelled. Signatures already made stay in the trail. You can make a new version and send that.</p>
            <label className="field"><span className="ws-flabel">Reason (optional, shown in the email)</span><input className="input sm" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Updated the dates" /></label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setVoiding(false)}>Keep it</button>
              <button className="btn danger" disabled={busy === "void"} onClick={() => void run("void", async () => { await voidDoc({ documentId: doc._id, reason: reason.trim() || undefined }); setVoiding(false); }, "Cancelled. The links no longer work.")}>Cancel signing</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------- after everyone signs (S3) ----------

const STEP_NAME = { pdf: "signed copy", invoice: "Stripe draft", copies: "emails", archive: "archive" } as const;
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function FinishedCard({ data, show }: { data: Data; show: (m: string) => void }) {
  const { doc } = data;
  const retry = useMutation(api.signDone.retry);
  const audit = useAction(api.signDone.downloadAudit);
  const [busy, setBusy] = useState<string | null>(null);
  const again = async (step: keyof typeof STEP_NAME) => {
    setBusy(step);
    try { await retry({ documentId: doc._id, step }); show(`Trying the ${STEP_NAME[step]} again…`); } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const getAudit = async () => {
    setBusy("audit");
    try {
      const r = await audit({ documentId: doc._id });
      const url = URL.createObjectURL(new Blob([r.json], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = r.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  const Retry = ({ step }: { step: keyof typeof STEP_NAME }) => <Button variant="ghost" size="sm" loading={busy === step} onClick={() => void again(step)}>Retry</Button>;
  const Done = () => <Icon name="check" size={16} className="ok" />;
  const f = doc.final;
  return (
    <section className="ws-card glass">
      <span className="label" title={doc.completedAt ? central(doc.completedAt) : undefined}>Signed copy{doc.completedAt ? ` · ${new Date(doc.completedAt).toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" })}` : ""}</span>
      {f ? (
        <>
          <div><a className="btn primary" href={data.finalUrl ?? undefined} download={f.fileName} target="_blank" rel="noreferrer">Download the signed PDF</a></div>
          <HashLine label="SHA-256" value={f.sha256} />
          <div><Button variant="ghost" size="sm" loading={busy === "audit"} onClick={() => void getAudit()} iconEnd="download">Download the audit record (JSON)</Button></div>
        </>
      ) : doc.finishError ? (
        <><p className="caption ws-err"><Icon name="alert" size={14} /> The signed copy couldn't be made: {doc.finishError}</p><Retry step="pdf" /></>
      ) : <p className="caption"><Spinner /> Making the signed copy…</p>}
      {f && (
        <ul className="ws-steps">
          <li>
            <Icon name="invoice" size={16} />
            {doc.invoice?.status === "created" ? <><span>Draft invoice {money(doc.invoice.amountCents ?? 0)}{doc.invoice.livemode ? "" : " (test mode)"}<br /><a className="ws-sub" href={doc.invoice.url} target="_blank" rel="noreferrer">Review and send in Stripe <Icon name="arrow-up-right" size={11} plain /></a></span><Done /></>
              : doc.invoice?.status === "none" ? <span className="secondary">No invoice set for this document.</span>
              : doc.invoice?.status === "failed" ? <><span className="ws-err">Stripe draft failed: {doc.invoice.error}</span><Retry step="invoice" /></>
              : <span className="secondary"><Spinner /> Stripe draft…</span>}
          </li>
          <li>
            <Icon name="mail" size={16} />
            {doc.copies?.status === "sent" ? <><span>Emailed to {doc.copies.sent.length} {doc.copies.sent.length === 1 ? "person" : "people"}<br /><span className="ws-sub">{doc.copies.sent.join(", ")}</span></span><Done /></>
              : doc.copies ? <><span className="ws-err">Emails {doc.copies.status === "partial" ? `sent to ${doc.copies.sent.length}, failed for` : "failed"}: {doc.copies.failed.join("; ") || "see the trail"}</span><Retry step="copies" /></>
              : <span className="secondary"><Spinner /> Emailing copies…</span>}
          </li>
          <li>
            <Icon name="folder" size={16} />
            {doc.archive?.status === "archived" ? <><span>In Dropbox › Apps/Wrangler Sign{doc.archive.pdfPath}{doc.archive.verified ? <><br /><span className="ws-sub">checked</span></> : ""}</span><Done /></>
              : doc.archive?.status === "waiting" ? <span className="secondary">Waiting for the archive to be connected (<a {...linkProps("/sign")}>Docs</a>). It's copied as soon as it is.</span>
              : doc.archive?.status === "failed" ? <><span className="ws-err">Archive failed: {doc.archive.error}</span><Retry step="archive" /></>
              : <span className="secondary"><Spinner /> Archiving…</span>}
          </li>
        </ul>
      )}
    </section>
  );
}

