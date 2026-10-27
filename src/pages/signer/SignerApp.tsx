// The client's signing page: sign.wranglerportal.com/<token> (Phase S2, Oct 27).
// Confirm the email with a code → agree to sign electronically → read → adopt a signature → initial → Sign.
// The page only asks; the backend checks every step again and logs it (convex/signing.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Lock, Mail, PenLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { BrandImg } from "../../ui/BrandImg";
import { Modal, Spinner } from "../../ui/kit";
import { getSession, setSession, ws, type WsResult } from "../../sign/client";
import { openPdf, renderPage, type PdfDoc } from "../../sign/pdf";
import { SignaturePad, type PadResult } from "../../sign/SignaturePad";

type Open = WsResult & { state: string; label?: string; title?: string; from?: string; signer?: string; email?: string; message?: string; verified?: boolean; expiresAt?: number | null; before?: string[] };
type Box = { id: string; kind: "sign" | "initials" | "name" | "date" | "title"; page: number; x: number; y: number; w: number; h: number; cover: { page: number; x: number; y: number; w: number; h: number } | null; who: "me" | "heston" | "other"; otherName: string | null; otherSigned: boolean | null };
type DocData = {
  label: string; title: string; versionNumber: number; fileSha256: string; lockHash: string; fileUrl: string; fileName: string;
  pages: Array<{ width: number; height: number; rotate: number }>; boxes: Box[]; expiresAt: number | null;
  me: { name: string; title: string | null; email: string; consentAt: number | null; initialed: string[]; adopted: { name: string; title: string | null; method: string; signatureUrl: string; initialsUrl: string } | null; signedAt: number | null; signedDate: string | null };
  heston: { name: string; title: string; signedDate: string; signatureUrl: string; initialsUrl: string } | null;
  consent: { id: string; lines: string[] }; statement: string; today: string;
  look?: { backdrop: string; image: string | null };
};

export default function SignerApp({ token }: { token: string }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [session, setSess] = useState<string | undefined>(() => getSession(token));
  const load = useCallback(async () => {
    const r = (await ws("open", { token, session: getSession(token) })) as Open;
    if (r.state === "ready" && !r.verified) { setSession(token, null); setSess(undefined); }
    setOpen(r);
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { document.title = open?.title ? `Sign: ${open.title}` : "Wrangler Sign"; }, [open?.title]);

  if (!open) return <Frame><p className="caption"><Spinner /> Opening…</p></Frame>;
  if (open.error && !open.state) return <Frame><Notice icon={<TriangleAlert size={18} />} title="Something's wrong with this link." text={open.error} /></Frame>;
  if (open.state !== "ready") {
    const titles: Record<string, string> = { missing: "This link doesn't go anywhere.", voided: "This document was cancelled.", expired: "This link has expired.", superseded: "There's a newer version.", signed: "You've signed this document.", waiting: "Not your turn yet." };
    return <Frame><Notice icon={open.state === "signed" ? <Check size={18} /> : <TriangleAlert size={18} />} title={titles[open.state] ?? "This link can't be used."} text={open.message ?? ""} sub={open.title ? `${open.title} · ${open.label}` : undefined} /></Frame>;
  }
  if (!session) return <Frame><Verify token={token} open={open} onVerified={(s) => { setSession(token, s); setSess(s); }} /></Frame>;
  return <Signing token={token} session={session} onLost={() => { setSession(token, null); setSess(undefined); void load(); }} onDone={() => void load()} />;
}

function Frame({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="wsx">
      <header className="wsx-top"><BrandImg name="wordmark" alt="Wrangler Productions" /><span className="wsx-secure"><Lock size={13} />Secure signing</span></header>
      <main className={`wsx-main${wide ? " wide" : ""}`}>{children}</main>
      <footer className="wsx-foot">Wrangler Productions, a DBA of Hill Creative LLC · Questions? Reply to the email that brought you here.</footer>
    </div>
  );
}

function Notice({ icon, title, text, sub }: { icon: React.ReactNode; title: string; text: string; sub?: string }) {
  return <div className="wsx-card"><span className="wsx-ico">{icon}</span><h1 className="headline">{title}</h1>{sub && <p className="caption secondary">{sub}</p>}<p className="caption">{text}</p></div>;
}

function Verify({ token, open, onVerified }: { token: string; open: Open; onVerified: (s: string) => void }) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ask = async () => {
    setBusy(true); setErr(null);
    const r = await ws("code", { token });
    setBusy(false);
    if (r.error) { setErr(r.error); if (r.code === "wait") setSent(true); return; }
    setSent(true); setNote(`We sent a 6-digit code to ${r.to}. It works for 10 minutes.`);
    setTimeout(() => input.current?.focus(), 50);
  };
  const check = async (c = code) => {
    if (c.length !== 6) return;
    setBusy(true); setErr(null);
    const r = await ws("verify", { token, code: c });
    setBusy(false);
    if (r.session) onVerified(r.session as string);
    else { setErr(r.error ?? "That didn't work."); if (r.code === "wrong") setCode(""); }
  };
  return (
    <div className="wsx-card">
      <span className="eyebrow">{open.label}</span>
      <h1 className="headline">{open.title}</h1>
      <p className="caption">{open.from} sent you this document to review and sign{open.signer ? `, ${open.signer}` : ""}.</p>
      {!sent ? (
        <>
          <p className="caption secondary">First, confirm it's you: we'll email a 6-digit code to <b className="wsx-nowrap">{open.email}</b>.</p>
          <button className="btn primary lg" onClick={() => void ask()} disabled={busy}>{busy ? <Spinner /> : <Mail size={17} />}Email me a code</button>
        </>
      ) : (
        <>
          {note && <p className="caption secondary">{note}</p>}
          <label className="field"><span className="label">Code</span>
            <input ref={input} className="input wsx-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} placeholder="••••••"
              onChange={(e) => { const c = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(c); if (c.length === 6) void check(c); }} />
          </label>
          <button className="btn primary lg" onClick={() => void check()} disabled={busy || code.length !== 6}>{busy ? <Spinner /> : <ShieldCheck size={17} />}Continue</button>
          <button className="btn ghost sm" onClick={() => void ask()} disabled={busy}>Send another code</button>
        </>
      )}
      {err && <p className="caption wsx-err"><TriangleAlert size={14} /> {err}</p>}
      {open.expiresAt && <p className="caption secondary wsx-small">This link works until {new Date(open.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</p>}
    </div>
  );
}

function Signing({ token, session, onLost, onDone }: { token: string; session: string; onLost: () => void; onDone: () => void }) {
  const [doc, setDoc] = useState<DocData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState<null | { complete: boolean }>(null);
  const call = useCallback(async (op: string, body: Record<string, unknown> = {}) => {
    const r = await ws(op, { token, session, ...body });
    if (r.code === "session" || r.code === "voided" || r.code === "expired" || r.code === "superseded") { onLost(); }
    return r;
  }, [token, session, onLost]);
  const refresh = useCallback(async () => {
    const r = await call("doc");
    if (r.error) { setErr(r.error); return; }
    setDoc(r as unknown as DocData);
  }, [call]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!doc?.fileUrl || pdf) return;
    openPdf(doc.fileUrl).then(setPdf, (e) => setErr(`Couldn't open the PDF: ${String(e?.message ?? e)}`));
  }, [doc?.fileUrl, pdf]);

  if (err) return <Frame><Notice icon={<TriangleAlert size={18} />} title="Something went wrong." text={err} /></Frame>;
  if (!doc) return <Frame><p className="caption"><Spinner /> Loading the document…</p></Frame>;
  if (signed || doc.me.signedAt) {
    return (
      <Frame>
        <div className="wsx-card">
          <span className="wsx-ico ok"><Check size={18} /></span>
          <h1 className="headline">Signed. Thank you.</h1>
          <p className="caption">{signed?.complete ? "Everyone has signed." : "We'll let you know when everyone has signed."} You'll get the signed PDF by email, with a record of every step.</p>
          <a className="btn" href={doc.fileUrl} target="_blank" rel="noreferrer" download={doc.fileName}><Download size={15} />Download the document you read</a>
          <button className="btn ghost sm" onClick={onDone}>Done</button>
        </div>
      </Frame>
    );
  }
  if (!doc.me.consentAt) return <Frame><Consent doc={doc} onAgree={async () => { const r = await call("consent", { agreed: true }); if (r.error) setErr(r.error); else await refresh(); }} /></Frame>;

  const mine = doc.boxes.filter((b) => b.who === "me");
  const initials = mine.filter((b) => b.kind === "initials");
  const todo = [...(doc.me.adopted ? [] : ["adopt"]), ...initials.filter((b) => !doc.me.initialed.includes(b.id)).map((b) => b.id)];
  const total = 1 + initials.length;
  const done = total - todo.length;
  const next = () => {
    const id = todo[0];
    if (id === "adopt") { const firstSign = mine.find((b) => b.kind === "sign" || b.kind === "initials"); scrollToBox(firstSign?.id); setAdopting(true); return; }
    if (id) scrollToBox(id); else document.getElementById("wsx-finish")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const tapBox = async (b: Box) => {
    if (!doc.me.adopted) { setAdopting(true); return; }
    if (b.kind !== "initials") return;
    const on = !doc.me.initialed.includes(b.id);
    setDoc({ ...doc, me: { ...doc.me, initialed: on ? [...doc.me.initialed, b.id] : doc.me.initialed.filter((x) => x !== b.id) } });
    const r = await call("initial", { boxId: b.id, on });
    if (r.error) { setErr(r.error); return; }
    if (on) { const rest = initials.filter((x) => x.id !== b.id && !doc.me.initialed.includes(x.id)); if (rest[0]) setTimeout(() => scrollToBox(rest[0].id), 250); else setTimeout(() => document.getElementById("wsx-finish")?.scrollIntoView({ behavior: "smooth", block: "center" }), 250); }
  };
  const sign = async () => {
    setBusy(true);
    const r = await call("sign", { agreed: true });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setSession(token, null); // the backend ends the session on signing
    setSigned({ complete: !!r.complete });
  };

  const look = doc.look;
  return (
    <div className="wsx wsx-look" style={look ? { background: look.image ? `${look.backdrop} center / cover fixed url(${look.image})` : look.backdrop } : undefined}>
      <header className="wsx-top sticky">
        <BrandImg name="wordmark" alt="Wrangler Productions" />
        <span className="wsx-doctitle">{doc.title}<span className="secondary"> · {doc.label}</span></span>
        <span className="wsx-progress" aria-live="polite">{done} of {total}</span>
        <button className="btn primary sm" onClick={next}>{todo.length ? (todo[0] === "adopt" ? "Start" : "Next") : "Finish"}<ChevronDown size={15} /></button>
      </header>
      <main className="wsx-main wide">
        <p className="caption secondary wsx-hint">{doc.me.adopted ? "Tap each initials box, then sign at the end." : "Read the document. When you're ready, tap Start to add your signature."}</p>
        {pdf ? <Pages pdf={pdf} doc={doc} onTap={tapBox} onViewed={(page) => void call("viewed", { page })} /> : <p className="caption"><Spinner /> Opening the PDF…</p>}
        <section id="wsx-finish" className="wsx-card wsx-finish">
          <h2 className="headline">Sign</h2>
          {todo.length ? (
            <p className="caption"><TriangleAlert size={14} /> {todo[0] === "adopt" ? "Adopt your signature first." : `${todo.length} initial box${todo.length === 1 ? "" : "es"} still to do.`} <button className="btn ghost sm" onClick={next}>Take me there</button></p>
          ) : (
            <>
              {doc.me.adopted && <div className="wsx-adopted"><img src={doc.me.adopted.signatureUrl} alt="Your signature" /><span className="caption secondary">{doc.me.adopted.name}{doc.me.adopted.title ? `, ${doc.me.adopted.title}` : ""} · {doc.today} <button className="btn ghost sm" onClick={() => setAdopting(true)}><PenLine size={13} />Change</button></span></div>}
              <label className="wsx-agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>{doc.statement}</span></label>
              <button className="btn primary lg" disabled={!agree || busy} onClick={() => void sign()}>{busy ? <Spinner /> : <PenLine size={17} />}Sign</button>
            </>
          )}
          <p className="caption secondary wsx-small">Version {doc.versionNumber} · document fingerprint (SHA-256) {doc.fileSha256.slice(0, 16)}… · <a href={doc.fileUrl} target="_blank" rel="noreferrer">Download the PDF</a></p>
        </section>
      </main>
      {adopting && <Adopt doc={doc} onClose={() => setAdopting(false)} onAdopted={async () => { setAdopting(false); await refresh(); const first = doc.boxes.find((b) => b.who === "me" && b.kind === "initials" && !doc.me.initialed.includes(b.id)); setTimeout(() => (first ? scrollToBox(first.id) : document.getElementById("wsx-finish")?.scrollIntoView({ behavior: "smooth", block: "center" })), 300); }} call={call} />}
    </div>
  );
}

function scrollToBox(id?: string) { if (id) document.querySelector(`[data-box="${id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }

function Consent({ doc, onAgree }: { doc: DocData; onAgree: () => Promise<void> }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="wsx-card">
      <span className="eyebrow">{doc.label}</span>
      <h1 className="headline">Signing electronically</h1>
      <div className="wsx-consent">{doc.consent.lines.map((l) => <p key={l} className="caption">{l}</p>)}</div>
      <p className="caption"><a href={doc.fileUrl} target="_blank" rel="noreferrer"><Download size={13} /> Open the document as a PDF</a> to check you can read it.</p>
      <label className="wsx-agree"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>I agree to receive and sign this document electronically, and I can open and read it.</span></label>
      <button className="btn primary lg" disabled={!ok || busy} onClick={async () => { setBusy(true); await onAgree(); setBusy(false); }}>{busy ? <Spinner /> : null}Continue</button>
    </div>
  );
}

function Adopt({ doc, onClose, onAdopted, call }: { doc: DocData; onClose: () => void; onAdopted: () => Promise<void>; call: (op: string, body?: Record<string, unknown>) => Promise<WsResult> }) {
  const [name, setName] = useState(doc.me.adopted?.name ?? doc.me.name);
  const needsTitle = doc.boxes.some((b) => b.who === "me" && b.kind === "title");
  const [title, setTitle] = useState(doc.me.adopted?.title ?? doc.me.title ?? "");
  const [pad, setPad] = useState<PadResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    if (!pad) return;
    setBusy(true); setErr(null);
    const r = await call("adopt", { name, title, method: pad.method, signature: pad.signatureUrl, initials: pad.initialsUrl });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    await onAdopted();
  };
  return (
    <Modal onClose={onClose} label="Adopt your signature" width={560}>
      <div className="wsx-adopt">
        <h2 className="headline">Your signature</h2>
        <div className={needsTitle ? "ws-row2" : ""}>
          <label className="field"><span className="label">Full name</span><input className="input sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></label>
          {needsTitle && <label className="field"><span className="label">Title</span><input className="input sm" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Owner" /></label>}
        </div>
        <SignaturePad name={name} onResult={setPad} />
        <p className="caption secondary">This signature and these initials go in your boxes on this document. You still sign at the end.</p>
        {err && <p className="caption wsx-err"><TriangleAlert size={14} /> {err}</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!pad || !name.trim() || busy} onClick={() => void go()}>{busy ? <Spinner /> : null}Adopt and continue</button>
        </div>
      </div>
    </Modal>
  );
}

function Pages({ pdf, doc, onTap, onViewed }: { pdf: PdfDoc; doc: DocData; onTap: (b: Box) => void; onViewed: (page: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const on = () => setWidth(Math.min(860, el.clientWidth));
    on(); const ro = new ResizeObserver(on); ro.observe(el); return () => ro.disconnect();
  }, []);
  const byPage = useMemo(() => { const m = new Map<number, Box[]>(); for (const b of doc.boxes) m.set(b.page, [...(m.get(b.page) ?? []), b]); return m; }, [doc.boxes]);
  return (
    <div ref={wrap} className="wsx-pages">
      {width > 0 && doc.pages.map((p, i) => <Page key={i} pdf={pdf} index={i} width={width} size={p} boxes={byPage.get(i) ?? []} doc={doc} onTap={onTap} onViewed={onViewed} />)}
    </div>
  );
}

function Page({ pdf, index, width, size, boxes, doc, onTap, onViewed }: { pdf: PdfDoc; index: number; width: number; size: { width: number; height: number }; boxes: Box[]; doc: DocData; onTap: (b: Box) => void; onViewed: (page: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState(false);
  const height = (width * size.height) / size.width;
  useEffect(() => {
    const el = sheet.current; if (!el) return;
    let drawnOnce = false, seen = false;
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (e.isIntersecting && !drawnOnce) { drawnOnce = true; if (canvas.current) renderPage(pdf, index, canvas.current, width).then(() => setDrawn(true), () => {}); }
        if (e.intersectionRatio >= 0.5 && !seen) { seen = true; onViewed(index); }
      }
    }, { rootMargin: "600px 0px", threshold: [0, 0.5] });
    io.observe(el);
    return () => io.disconnect();
  }, [pdf, index, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = (r: { x: number; y: number; w: number; h: number }) => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
  return (
    <div className="ws-pagewrap">
      <div ref={sheet} className="ws-sheet wsx-sheet" style={{ width, height }}>
        <canvas ref={canvas} aria-label={`Page ${index + 1} of ${doc.pages.length}`} />
        {!drawn && <span className="ws-pageph"><Spinner /></span>}
        {boxes.filter((b) => b.cover).map((b) => <span key={`c${b.id}`} className="wsx-cover" style={pct(b.cover!)} aria-hidden />)}
        {boxes.map((b) => <BoxView key={b.id} b={b} doc={doc} style={pct(b)} onTap={() => onTap(b)} />)}
      </div>
      <span className="ws-pagenum secondary">Page {index + 1} of {doc.pages.length}</span>
    </div>
  );
}

function BoxView({ b, doc, style, onTap }: { b: Box; doc: DocData; style: React.CSSProperties; onTap: () => void }) {
  const a = doc.me.adopted, h = doc.heston;
  const text = (t: string) => <span className="wsx-fill text">{t}</span>;
  const img = (src: string, alt: string) => <img className="wsx-fill" src={src} alt={alt} />;
  if (b.who === "heston") {
    if (!h) return null;
    const v = b.kind === "sign" ? img(h.signatureUrl, `${h.name}'s signature`) : b.kind === "initials" ? img(h.initialsUrl, `${h.name}'s initials`) : text(b.kind === "date" ? h.signedDate : b.kind === "name" ? h.name : h.title);
    return <div className="wsx-box done" style={style} data-box={b.id}>{v}</div>;
  }
  if (b.who === "other") return <div className="wsx-box other" style={style}><span className="wsx-boxlabel">{b.otherSigned ? `Signed by ${b.otherName}` : `For ${b.otherName}`}</span></div>;
  // Mine.
  if (b.kind === "initials") {
    const on = doc.me.initialed.includes(b.id);
    return (
      <button type="button" className={`wsx-box mine${on ? " done" : " todo"}`} style={style} data-box={b.id} onClick={onTap} aria-pressed={on} aria-label={on ? "Initialed. Tap to remove." : "Tap to initial"}>
        {on && a ? img(a.initialsUrl, "Your initials") : <span className="wsx-boxlabel">Initial</span>}
      </button>
    );
  }
  if (b.kind === "sign") {
    return (
      <button type="button" className={`wsx-box mine${a ? " done" : " todo"}`} style={style} data-box={b.id} onClick={onTap} aria-label={a ? "Your signature (it's applied when you sign)" : "Tap to add your signature"}>
        {a ? img(a.signatureUrl, "Your signature") : <span className="wsx-boxlabel">Sign here</span>}
      </button>
    );
  }
  const v = b.kind === "date" ? doc.today : b.kind === "name" ? a?.name ?? doc.me.name : a?.title ?? doc.me.title ?? "";
  return <div className={`wsx-box mine auto${a ? " done" : ""}`} style={style} data-box={b.id}>{a ? text(v) : <span className="wsx-boxlabel">{b.kind === "date" ? "Date" : b.kind === "name" ? "Name" : "Title"}</span>}</div>;
}
