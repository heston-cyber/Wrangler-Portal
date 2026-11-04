// D149 · sending a quote or proposal to anyone (S5 · Phase 3b "To anyone": 871:20283 to a client, 871:20336 to anyone,
// 887:9847 several addresses, 873:20908 proposal) and the owner's "Opened and accepted" card (872:20151, 873:20972).
// To takes one or more addresses, comma-separated; each gets their own link. Name is optional and turns off with
// several addresses (every email opens "Hello,", Q102). Copy link and Download PDF send nothing. Nov 4: stop one
// person's link, and make a new copied link.
import { useState } from "react";
import { Button, DialogHeader } from "../../ui/wp";
import { Modal } from "../../ui/kit";
import { errText } from "../docs/pages/common";
import { dateShort } from "./common";

export type OfferPeople = {
  people: Array<{ _id: string; name: string | null; email: string; openedAt: number | null; opens: number; stopped: boolean; response: { kind: "accepted" | "declined"; at: number; name: string; company: string | null } | null }>;
  link: { copied: boolean; opens: number; answer: { kind: "accepted" | "declined"; at: number; name: string; email: string | null; company: string | null } | null };
};
const when = (t: number) => `${dateShort(t)}, ${new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function SendOfferDialog({ kind, number, initialTo = "", initialName = "", toClient, summary, extra, onSend, onCopyLink, onPdf, onClose }: {
  kind: "quote" | "proposal"; number: string; initialTo?: string; initialName?: string; toClient?: boolean; summary?: React.ReactNode; extra?: React.ReactNode;
  onSend: (to: string, name: string) => Promise<void>; onCopyLink: () => Promise<string | null>; onPdf: () => Promise<void> | void; onClose: () => void;
}) {
  const [to, setTo] = useState(initialTo), [name, setName] = useState(initialName);
  const [busy, setBusy] = useState<null | "send" | "link" | "pdf">(null);
  const [err, setErr] = useState<string | null>(null);
  const several = to.split(/[,;\n]+/).filter((x) => x.trim()).length > 1 || /[,;]/.test(to);
  const thing = kind === "quote" ? "quote" : "proposal";
  const run = async (what: "send" | "link" | "pdf") => {
    setBusy(what); setErr(null);
    try {
      if (what === "send") { if (!to.trim()) throw new Error("Add who it goes to."); await onSend(to, several ? "" : name); }
      else if (what === "link") { const url = await onCopyLink(); if (url) { try { await navigator.clipboard.writeText(url); } catch { /* the toast shows it */ } } }
      else await onPdf();
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  return (
    <Modal onClose={onClose} label={`Send the ${thing}`} width={560}>
      <div className="crm-dialog of-send">
        <DialogHeader eyebrow={number} title={`Send the ${thing}?`} body={`${toClient ? "It goes to them" : "Each address gets its own link"} to read it and accept or decline. No account needed. Nothing goes out until you press Send.`} onClose={onClose} />
        <div className="of-to">
          <label className="wp-field"><span className="wp-field-label">To</span>
            <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" autoComplete="off" /></label>
          <label className="wp-field"><span className="wp-field-label">Name (optional)</span>
            <input className="input" value={several ? "" : name} disabled={several} onChange={(e) => setName(e.target.value)} placeholder={several ? "Off with several addresses" : "Priya"} /></label>
        </div>
        <p className="wp-small secondary">{several ? "Every email opens “Hello,”." : `Anyone can get a ${thing}, not only clients. Separate several addresses with a comma.`}</p>
        {extra}
        {summary}
        <div className="bf-or"><span className="wp-label">Or share it yourself</span>
          <div className="bf-orrow"><span><b>Copy link</b><span className="secondary">No email goes out. Anyone with the link can open and accept it; they give their name, email and company.</span></span>
            <Button size="sm" loading={busy === "link"} disabled={!!busy && busy !== "link"} onClick={() => void run("link")}>Copy link</Button></div>
          <div className="bf-orrow"><span><b>Download PDF</b><span className="secondary">A file you send yourself, with no link.</span></span>
            <Button size="sm" loading={busy === "pdf"} disabled={!!busy && busy !== "pdf"} onClick={() => void run("pdf")}>Download PDF</Button></div>
        </div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="dfoot">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <Button variant="primary" loading={busy === "send"} disabled={!!busy && busy !== "send"} onClick={() => void run("send")}>Send {thing}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** "Opened and accepted" (872:20151): each person, the copied link, and the controls. */
export function OfferPeopleCard({ who, open, onStop, onNewLink, show }: {
  who: OfferPeople; open: boolean; onStop: (personId: string) => Promise<unknown>; onNewLink: () => Promise<string>; show: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, f: () => Promise<unknown>, done: string) => { setBusy(key); try { await f(); show(done); } catch (e) { show(errText(e)); } finally { setBusy(null); } };
  if (!who.people.length && !who.link.copied) return null;
  const line = (p: OfferPeople["people"][number]) => p.stopped ? "Link stopped"
    : p.response ? `${p.response.kind === "accepted" ? "Accepted" : "Declined"} ${when(p.response.at)}`
    : p.openedAt ? `Opened ${when(p.openedAt)} · not ${open ? "answered" : "accepted"}` : "Not opened yet";
  return (
    <section className="wp-card glass of-people" aria-label="Opened and accepted">
      <span className="wp-eyebrow">Opened and accepted</span>
      {who.people.map((p) => (
        <div key={p._id} className="of-person">
          <span className="txt"><b>{p.response?.kind === "accepted" ? p.response.name : p.name || p.email}</b>
            {(p.name || p.response?.kind === "accepted" || p.response?.company) && <span className="secondary">{[p.email, p.response?.company].filter(Boolean).join(" · ")}</span>}
            <span className="secondary">{line(p)}</span></span>
          {open && !p.stopped && !p.response && !p._id.startsWith("legacy:") && <button type="button" className="btn ghost sm" disabled={busy === p._id} onClick={() => void run(p._id, () => onStop(p._id), `${p.email}'s link is stopped.`)}>Stop link</button>}
        </div>
      ))}
      {who.link.copied && (
        <div className="of-person">
          <span className="txt"><b>{who.link.answer?.kind === "accepted" ? who.link.answer.name : "Copied link"}</b>
            {who.link.answer?.kind === "accepted" && <span className="secondary">{[who.link.answer.email, who.link.answer.company].filter(Boolean).join(" · ")} · accepted on the copied link</span>}
            <span className="secondary">{who.link.opens ? `${plural(who.link.opens, "open", "opens")} · names aren’t known` : "Not opened yet"}</span></span>
          {open && <button type="button" className="btn ghost sm" disabled={busy === "link"} onClick={() => void run("link", async () => { const url = await onNewLink(); try { await navigator.clipboard.writeText(url); } catch { /* shown */ } }, "New link copied. The old copied link stops working.")}>New copied link</button>}
        </div>
      )}
    </section>
  );
}
