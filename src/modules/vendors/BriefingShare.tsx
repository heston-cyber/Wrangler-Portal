// D147 · briefings sent freely, the owner's side (S5 · Phase 3c): the builder's Briefing panel (863:15661: Project
// (optional), Send to), the Share dialog (863:16118: Send, Copy link, Download PDF), and the briefing's page once it's
// shared (863:16685 sent, 863:17184 link turned off: Actions and "Who has it"). Saving sends nothing.
import { useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, DialogHeader, TextArea } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText, uploadToStorage } from "../docs/pages/common";
import { PdfPages } from "../proposals/ClientProposal";
import { Banner } from "../payments/ClientInvoice";
import { dateShort } from "../payments/common";

export type BriefingInfo = NonNullable<FunctionReturnType<typeof api.briefings.get>>;
export type To = { vendorId?: Id<"vendors">; email: string; name?: string; label: string; booked?: boolean };
const EMAIL = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']{2,}$/;
const day = (t: number) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : dateShort(t));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const plain = (t: To) => ({ ...(t.vendorId ? { vendorId: t.vendorId } : {}), email: t.email, ...(t.name ? { name: t.name } : {}) });

/** Send to: vendors from your list (booked or not), "Everyone booked on {project}", or any email typed in. */
export function SendToPicker({ b, value, onChange, disabled }: { b: BriefingInfo; value: To[]; onChange: (to: To[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const have = new Set(value.map((t) => t.email.toLowerCase()));
  const booked = b.vendors.filter((vd) => vd.booked && !have.has(vd.email.toLowerCase()));
  const q = text.trim().toLowerCase();
  const matches = b.vendors.filter((vd) => !have.has(vd.email.toLowerCase()) && (!q || vd.name.toLowerCase().includes(q) || vd.email.toLowerCase().includes(q))).slice(0, 6);
  const addVendor = (vd: BriefingInfo["vendors"][number]) => onChange([...value, { vendorId: vd._id, email: vd.email.toLowerCase(), name: vd.name, label: vd.name, booked: vd.booked }]);
  const addTyped = () => {
    const parts = text.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) { if (matches[0]) { addVendor(matches[0]); setText(""); } return; }
    const bad = parts.filter((x) => !EMAIL.test(x));
    if (bad.length && !(parts.length === 1 && matches[0])) { setErr(`“${bad[0]}” isn't an email address.`); return; }
    if (bad.length) { addVendor(matches[0]); setText(""); setErr(null); return; }
    const add = parts.map((x) => x.toLowerCase()).filter((x, i, all) => !have.has(x) && all.indexOf(x) === i).map((email) => {
      const vd = b.vendors.find((y) => y.email.toLowerCase() === email);
      return vd ? { vendorId: vd._id, email, name: vd.name, label: vd.name, booked: vd.booked } : { email, label: email };
    });
    onChange([...value, ...add]); setText(""); setErr(null);
  };
  return (
    <div className="bf-to">
      <div className="bf-combo">
        <Icon name="mail" size={16} />
        <input ref={input} className="input" value={text} disabled={disabled} placeholder="Add a vendor or type an email" aria-label="Add a vendor or type an email"
          onChange={(e) => { setText(e.target.value); setErr(null); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTyped(); } }} />
        {open && (matches.length > 0 || (b.project && booked.length > 0)) && (
          <div className="bf-menu" role="listbox" aria-label="Vendors">
            {b.project && booked.length > 0 && !q && <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange([...value, ...booked.map((vd) => ({ vendorId: vd._id, email: vd.email.toLowerCase(), name: vd.name, label: vd.name, booked: true }))]); }}>
              <b>Everyone booked on {b.project.label}</b><span className="secondary">{booked.map((vd) => vd.name).join(", ")}</span></button>}
            {matches.map((vd) => <button key={vd._id} type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => { addVendor(vd); setText(""); }}>
              <b>{vd.name}{vd.booked ? " · booked" : ""}</b><span className="secondary">{vd.email}</span></button>)}
          </div>
        )}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {value.length > 0 && <div className="bf-chips">{value.map((t) => (
        <span key={t.email} className="bf-chip">{t.label}{t.booked ? " · booked" : ""}
          {!disabled && <button type="button" aria-label={`Remove ${t.label}`} onClick={() => onChange(value.filter((x) => x.email !== t.email))}><Icon name="close" size={12} /></button>}</span>))}</div>}
    </div>
  );
}

/** The builder's Briefing panel (under Insert): Project (optional) and Send to. Each change is saved; nothing is sent. */
export function BriefingPanel({ b, onProject, show }: { b: BriefingInfo; onProject: (label: string) => void; show: (m: string) => void }) {
  const setDetails = useMutation(api.briefings.setDetails);
  const to: To[] = b.sendTo.map((t) => ({ ...t, label: t.label }));
  const save = async (projectId: string | null, list: To[]) => {
    try { await setDetails({ briefingId: b._id, projectId: projectId as Id<"projects"> | null, sendTo: list.map(plain) }); } catch (e) { show(errText(e)); }
  };
  return (
    <div className="wsb-brief bf-panel">
      <span className="label">Briefing</span>
      <label className="field"><span className="ws-flabel">Project (optional)</span>
        <select className="input sm" value={b.project?._id ?? ""} onChange={(e) => { const p = b.projects.find((x) => x._id === e.target.value); void save(p?._id ?? null, to); onProject(p?.label ?? ""); }}>
          <option value="">No project</option>
          {b.projects.map((p) => <option key={p._id} value={p._id}>{p.label}</option>)}
        </select></label>
      <div className="field"><span className="ws-flabel">Send to</span><SendToPicker b={b} value={to} onChange={(list) => void save(b.project?._id ?? null, list)} /></div>
      <p className="caption secondary">Pick vendors from your list, booked or not, or type any email address. Saving sends nothing; you choose when to Share.</p>
    </div>
  );
}

/** Share the briefing (863:16118). makePdf: a draft is saved and drawn first (its PDF is frozen the first time it's shared). */
export function ShareBriefing({ b, initial, makePdf, onClose, onShared, show }: {
  b: BriefingInfo; initial: To[]; makePdf?: () => Promise<Blob>; onClose: () => void; onShared?: () => void; show: (m: string) => void;
}) {
  const share = useAction(api.briefings.share);
  const uploadUrl = useMutation(api.builder.uploadUrl);
  const [to, setTo] = useState<To[]>(initial);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState<null | "send" | "link" | "pdf">(null);
  const [err, setErr] = useState<string | null>(null);
  const draft = b.state === "draft";
  const frozen = async () => {
    if (!draft || !makePdf) return undefined;
    const blob = await makePdf();
    return uploadToStorage(await uploadUrl({}), new File([blob], `${b.title}.pdf`, { type: "application/pdf" }));
  };
  const copyText = async (url: string) => { try { await navigator.clipboard.writeText(url); return true; } catch { return false; } };
  const onSend = async () => {
    if (!to.length) { setErr("Add who it goes to."); return; }
    setBusy("send"); setErr(null);
    try {
      const r = await share({ briefingId: b._id, storageId: await frozen(), to: to.map(plain), ...(words.trim() ? { note: words.trim() } : {}) });
      const parts = [r.sent ? `Sent to ${plural(r.sent, "person", "people")}` : null, r.held ? `${r.held} held (email sending is limited on this site)` : null,
        r.off ? `${r.off} switched briefing emails off (it's in their vendor portal)` : null, r.failed.length ? `didn't send to ${r.failed.join(", ")}` : null].filter(Boolean);
      show(parts.join(". ") || "Shared.");
      onShared?.(); onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const onLink = async () => {
    setBusy("link"); setErr(null);
    try {
      const r = await share({ briefingId: b._id, storageId: await frozen(), to: [], copyLink: true });
      show(r.link && (await copyText(r.link)) ? "Link copied. Anyone with it can open the briefing; opens are counted, not named." : `The link: ${r.link}`);
      onShared?.(); onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  const onPdf = async () => {
    setBusy("pdf"); setErr(null);
    try {
      if (draft && makePdf) {
        const url = URL.createObjectURL(await makePdf());
        const a = document.createElement("a"); a.href = url; a.download = `${b.title}.pdf`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } else if (b.pdfUrl) window.open(b.pdfUrl, "_blank", "noopener");
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  return (
    <Modal onClose={onClose} label="Share the briefing" width={560}>
      <div className="crm-dialog bf-share">
        <DialogHeader eyebrow={`Share · ${b.kindName}`} title="Share the briefing" body="Send emails each person a link to read it, with no login. Nothing goes out until you press Send. You can also copy the link or download a PDF and send it yourself." onClose={onClose} />
        <div className="wp-field"><span className="wp-field-label">Send to</span><SendToPicker b={b} value={to} onChange={setTo} disabled={!!busy} /></div>
        <TextArea label="A few words (optional)" rows={3} value={words} onChange={(e) => setWords(e.target.value)} placeholder="e.g. Call is 7:00 AM. Questions? Reply to the email." />
        <div className="bf-or"><span className="wp-label">Or share it yourself</span>
          <div className="bf-orrow"><span><b>Copy link</b><span className="secondary">No email goes out. Anyone with the link can open it. Opens are counted, not named.</span></span>
            <Button size="sm" loading={busy === "link"} disabled={!!busy && busy !== "link"} onClick={() => void onLink()}>{b.link.copied ? "Copy the link" : "Copy link"}</Button></div>
          <div className="bf-orrow"><span><b>Download PDF</b><span className="secondary">A file you send yourself, with no link.</span></span>
            <Button size="sm" loading={busy === "pdf"} disabled={!!busy && busy !== "pdf"} onClick={() => void onPdf()}>Download PDF</Button></div>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy === "send"} disabled={!!busy && busy !== "send"} onClick={() => void onSend()}>Send</Button>
        </div>
      </div>
    </Modal>
  );
}

/** What "Who has it" says for one person (863:16685). */
const status = (p: BriefingInfo["who"][number]) => (p.readAt ? `Marked read ${day(p.readAt)}` : p.openedAt ? `Opened ${day(p.openedAt)}` : "Not opened yet");

/** A briefing once it's shared: the PDF they read, Actions, and who has it. */
export function BriefingPage({ b, show, toast }: { b: BriefingInfo; show: (m: string) => void; toast: React.ReactNode }) {
  const setLinkOff = useMutation(api.briefings.setLinkOff);
  const share = useAction(api.briefings.share);
  const copyBriefing = useMutation(api.briefings.copy);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState<null | "link" | "off" | "copy">(null);
  const opened = b.who.filter((p) => p.openedAt).length, read = b.who.filter((p) => p.readAt).length;
  const summary = useMemo(() => [
    b.who.length ? `Sent to ${plural(b.who.length, "person", "people")}` : null, b.who.length ? `${opened} opened` : null, b.who.length ? `${read} marked read` : null,
    b.link.copied ? (b.link.opens ? `copied link opened ${plural(b.link.opens, "time", "times")}` : "copied link not opened yet") : null,
  ].filter(Boolean).join(" · "), [b.who.length, opened, read, b.link.copied, b.link.opens]);
  const run = async (what: "link" | "off" | "copy") => {
    setBusy(what);
    try {
      if (what === "off") { await setLinkOff({ briefingId: b._id, off: !b.link.off }); show(b.link.off ? "The link is on again. Every link works." : "The link is off. No one can open it now, including the people it was emailed to."); }
      else if (what === "copy") { const id = await copyBriefing({ briefingId: b._id }); navigate(`/vendors/briefings/${id}`); return; }
      else {
        const r = await share({ briefingId: b._id, to: [], copyLink: true });
        let ok = false; try { if (r.link) { await navigator.clipboard.writeText(r.link); ok = true; } } catch { /* shown below */ }
        show(ok ? "Link copied. Anyone with it can open the briefing; opens are counted, not named." : `The link: ${r.link}`);
      }
    } catch (e) { show(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <TopBar><a {...linkProps("/production")}>Production</a><Sep /><a {...linkProps("/vendors/briefings")}>Briefings</a><Sep /><span className="here">{b.kindName}</span></TopBar>
      <div className="wp-page bf-page">
        <header className="wp-pagehead">
          <div className="txt"><span className="wp-eyebrow">Briefing{b.project ? ` · ${b.project.label}` : ""}</span><h1 className="wp-h2">{b.kindName}.</h1>
            <p className="wp-body">{[b.title, b.dates, b.sentAt ? `shared ${day(b.sentAt)}` : null].filter(Boolean).join(" · ")}</p></div>
          <div className="actions"><Button variant="primary" disabled={b.link.off} title={b.link.off ? "Turn the link back on first" : undefined} onClick={() => setSharing(true)}>Share</Button></div>
        </header>
        {b.link.off ? <Banner tone="neutral" icon="info" title="The link is turned off." text="No one can open the briefing, including the people it was emailed to. Turn it back on any time; the same links work again." />
          : <Banner tone="neutral" icon="info" title={summary || "Shared"} text="Saving never sends anything. A copied link works for whoever has it; opens are counted, not named." />}
        <div className="q-cols">
          <div className="col">{b.pdfUrl ? <PdfPages url={b.pdfUrl} title={b.title} /> : <Card label="Briefing"><p className="vd-pad">The PDF couldn't be shown.</p></Card>}</div>
          <div className="col right">
            <section className="wp-card glass bf-actions" aria-label="Actions">
              <span className="wp-eyebrow">Actions</span>
              <Button disabled={b.link.off} onClick={() => setSharing(true)}>Share again</Button>
              <Button loading={busy === "link"} disabled={b.link.off} onClick={() => void run("link")}>Copy link</Button>
              {b.pdfUrl && <a className="btn" href={b.pdfUrl} target="_blank" rel="noopener noreferrer" download>Download PDF</a>}
              <Button variant="ghost" loading={busy === "off"} onClick={() => void run("off")}>{b.link.off ? "Turn link back on" : "Turn off link"}</Button>
              <Button variant="ghost" loading={busy === "copy"} onClick={() => void run("copy")}>Make a copy to change it</Button>
            </section>
            <section className="wp-card glass bf-who" aria-label="Who has it">
              <span className="wp-eyebrow">Who has it</span>
              {b.who.length === 0 && !b.link.copied && <p className="wp-small secondary">No one yet. Share it to send it.</p>}
              <dl>
                {b.who.map((p) => <div key={p._id}><dt>{p.label}{p.booked ? " · booked" : ""}</dt><dd>{status(p)}</dd></div>)}
                {b.link.copied && <div><dt>Copied link</dt><dd>{b.link.opens ? `${plural(b.link.opens, "open", "opens")}, not named` : "Not opened yet"}{b.link.reads ? ` · ${b.link.reads} marked read` : ""}</dd></div>}
              </dl>
            </section>
          </div>
        </div>
      </div>
      {sharing && <ShareBriefing b={b} initial={[]} onClose={() => setSharing(false)} show={show} />}
      {toast}
    </>
  );
}
