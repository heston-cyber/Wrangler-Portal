// Post a note (P1 / Owner / Post a note): To (a client and its people), title, message, an optional link to a cut or
// a document, "Also email them", and a live preview of their Inbox and the email. Nothing reaches a client until
// you press Send note and confirm. A draft Claude wrote opens here with the "Drafted by Claude" banner.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button, Card, Checkbox, DialogHeader, Divider, InboxItem, ListRow, SectionHead, SkeletonRows, StatusChip, TextArea, TextField, Toggle } from "../../ui/wp";
import { Icon, type IconName } from "../../ui/Icon";
import { Modal, useToast } from "../../ui/kit";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { errText } from "../docs/pages/common";
import { firstName } from "../inbox/common";

type Link = { link: string; label: string; box: string; icon: IconName } | null;
const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const firstLine = (t: string) => t.trim().split(/\n/)[0] ?? "";

function InboxPreview({ who, title, detail }: { who: string; title: string; detail: string }) {
  return (
    <Card className="pn-prev" label="Inbox preview" head={<SectionHead label={`Preview · ${who}'s Inbox`} />}>
      <InboxItem icon="mail" title={title || "Your title"} detail={detail} time="Now" unread />
    </Card>
  );
}
function EmailPreview({ business, title, text, button }: { business: string; title: string; text: string; button: string }) {
  return (
    <Card className="pn-prev" label="Email preview" head={<SectionHead label="Preview · Email" />}>
      <div className="pn-email">
        <p className="subj">Subject: {title || "Your title"}</p>
        <div className="mail">
          <span className="wp-eyebrow">A note from {business}</span>
          <b>{title || "Your title"}</b>
          {text && <p>{text.length > 90 ? `${text.slice(0, 88).trimEnd()}…` : text}</p>}
          <span className="btn primary sm" aria-hidden>{button}</span>
        </div>
      </div>
    </Card>
  );
}

function PickPeople({ clients, clientId, setClientId, people, picked, setPicked, onClose }: {
  clients: Array<{ _id: Id<"clients">; name: string }>; clientId: Id<"clients"> | null; setClientId: (id: Id<"clients">) => void;
  people: Array<{ email: string; name: string | null; access: boolean }> | undefined; picked: Set<string>; setPicked: (s: Set<string>) => void; onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} label="Who it goes to" width={520}>
      <div className="pn-pick">
        <DialogHeader eyebrow="To" title="Who it goes to." body="Only people with portal access get it in their Inbox." onClose={onClose} />
        <label className="wp-field"><span className="wp-field-label">Client</span>
          <span className="ws-select"><select value={clientId ?? ""} onChange={(e) => setClientId(e.target.value as Id<"clients">)}>
            {!clientId && <option value="">Pick a client</option>}
            {clients.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select><Icon name="chevron-down" size={16} /></span>
        </label>
        {clientId && (people === undefined ? <SkeletonRows n={2} /> : people.length === 0 ? <p className="wp-small">No people on this client yet. Add them on the client page.</p> : (
          <div className="pn-people">
            {people.map((p) => (
              <Checkbox key={p.email} disabled={!p.access} checked={p.access && picked.has(p.email)} label={p.name ?? p.email} hint={p.access ? p.email : `${p.email} · not invited to the portal`}
                onChange={(on) => { const s = new Set(picked); if (on) s.add(p.email); else s.delete(p.email); setPicked(s); }} />
            ))}
          </div>
        ))}
        <div className="dfoot"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </div>
    </Modal>
  );
}

function AttachPicker({ kind, clientId, onPick, onClose }: { kind: "cut" | "doc"; clientId: Id<"clients">; onPick: (l: Link) => void; onClose: () => void }) {
  const page = useQuery(api.clients.page, { clientId });
  return (
    <Modal onClose={onClose} label={kind === "cut" ? "Attach a cut" : "Attach a document"} width={560}>
      <div className="pn-pick">
        <DialogHeader eyebrow="Link" title={kind === "cut" ? "Attach a cut." : "Attach a document."} body={kind === "cut" ? "Cuts already shared with them." : "Documents sent to them."} onClose={onClose} />
        <div className="wp-card pn-list">
          <div className="wp-rows">
            {page === undefined ? <SkeletonRows n={3} />
              : kind === "cut" ? (page?.shared.length ? page.shared.map((s, i) => (
                <div key={s.versionId} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow lead={{ thumb: s.thumbUrl, size: 64 }} title={`${s.title} · v${s.number}`} meta={s.invited ? "Shared with their people" : "Shared by link"}
                    onClick={() => onPick({ link: `/s/${s.token}/v/${s.videoId}?version=${s.number}`, label: `Watch ${s.title} v${s.number}`, box: `${s.title} · v${s.number}`, icon: "video" })} />
                </div>)) : <ListRow className="ilead quiet" lead={{ icon: "send" }} title="Nothing is shared with them yet. Share a cut from the client page first." />)
              : (page?.documents.length ? page.documents.map((d, i) => (
                <div key={d._id} className="wp-rowwrap">{i > 0 && <Divider />}
                  <ListRow className="ilead" lead={{ icon: "document" }} title={`${d.label} · ${d.title}`} meta={d.status === "completed" ? "Signed" : d.status === "voided" ? "Cancelled" : "To sign"}
                    onClick={() => onPick({ link: `/docs${d.status === "completed" ? "?tab=signed" : d.status === "voided" ? "?tab=cancelled" : ""}`, label: `Open ${d.title}`, box: `${d.label} · ${d.title}`, icon: "document" })} />
                </div>)) : <ListRow className="ilead quiet" lead={{ icon: "document" }} title="No documents sent to them yet." />)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function PostNote({ noteId: noteParam, clientId: clientParam }: { noteId: Id<"inboxNotes"> | null; clientId: Id<"clients"> | null }) {
  const draft = useQuery(api.inbox.noteDetail, noteParam ? { noteId: noteParam } : "skip");
  const clients = useQuery(api.clients.directory);
  const biz = useQuery(api.business.settings, {});
  const save = useMutation(api.inbox.saveNote);
  const send = useMutation(api.inbox.sendNote);
  const [toast, show] = useToast();
  const [noteId, setNoteId] = useState<Id<"inboxNotes"> | null>(noteParam);
  const [clientId, setClientIdRaw] = useState<Id<"clients"> | null>(clientParam);
  const [title, setTitle] = useState(""), [text, setText] = useState("");
  const [link, setLink] = useState<Link>(null);
  const [emailThem, setEmailThem] = useState(true);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = everyone with access
  const [loaded, setLoaded] = useState(!noteParam);
  const [dialog, setDialog] = useState<null | "to" | "cut" | "doc" | "preview" | "confirm">(null);
  const [busy, setBusy] = useState<null | "save" | "send">(null);
  const [err, setErr] = useState<string | null>(null);
  const people = useQuery(api.inbox.noteRecipients, clientId ? { clientId } : "skip");

  // A saved draft (yours or Claude's) fills the form once.
  useEffect(() => {
    if (!draft || loaded) return;
    if (draft.status === "sent") { navigate(`/sent/${draft._id}`); return; }
    setClientIdRaw(draft.clientId); setTitle(draft.title); setText(draft.text); setEmailThem(draft.emailThem);
    setLink(draft.link ? { link: draft.link, label: draft.linkLabel ?? "Open in the portal", box: draft.linkLabel?.replace(/^(Watch|Open) /, "") ?? draft.link, icon: draft.link.startsWith("/s/") ? "video" : "document" } : null);
    setPicked(draft.to ? new Set(draft.to) : null);
    setLoaded(true);
  }, [draft, loaded]);
  const setClientId = (id: Id<"clients">) => { if (id !== clientId) { setClientIdRaw(id); setPicked(null); setLink(null); } };

  const withAccess = useMemo(() => (people ?? []).filter((p) => p.access), [people]);
  const chosen = picked ? withAccess.filter((p) => picked.has(p.email)) : withAccess;
  const client = clients?.find((c) => c._id === clientId) ?? null;
  const business = biz?.name ?? "your business";
  const replyTo = biz?.replyTo || biz?.ownerEmail || "";
  const fromClaude = draft?.draftedBy === "claude";
  const backTo = clientParam ? { to: `/clients/${clientParam}`, label: client?.name ?? "Client" } : { to: "/sent", label: "Sent" };

  const toArg = () => (picked && withAccess.some((p) => !picked.has(p.email)) ? [...picked].filter((e) => withAccess.some((p) => p.email === e)) : undefined);
  const persist = async () => {
    if (!clientId) throw new Error("Pick who it goes to.");
    const id = await save({ noteId: noteId ?? undefined, clientId, title, text, link: link?.link, linkLabel: link?.label, to: toArg(), emailThem });
    if (!noteId) { setNoteId(id); history.replaceState(null, "", `/sent/new?note=${id}${clientParam ? `&client=${clientParam}` : ""}`); }
    return id;
  };
  const doSave = async () => { setBusy("save"); setErr(null); try { await persist(); show("Draft saved."); } catch (e) { setErr(errText(e)); } finally { setBusy(null); } };
  const askSend = () => {
    setErr(null);
    if (!clientId) { setErr("Pick who it goes to."); return; }
    if (!title.trim()) { setErr("Give the note a title."); return; }
    if (!chosen.length) { setErr(people?.length ? "Pick at least one person with portal access." : `No one at ${client?.name ?? "this client"} has portal access yet. Invite someone first.`); return; }
    setDialog("confirm");
  };
  const doSend = async () => {
    setBusy("send"); setErr(null);
    try {
      const id = await persist();
      const r = await send({ noteId: id });
      navigate(`/sent/${id}?sent=${r.sent}`);
    } catch (e) { setErr(errText(e)); setDialog(null); } finally { setBusy(null); }
  };

  if (noteParam && draft === undefined) return <><TopBar><a {...linkProps("/sent")}>Sent</a><Sep /><span className="here">Post a note</span></TopBar><div className="wp-page"><Card label="Loading"><SkeletonRows n={4} /></Card></div></>;
  if (noteParam && draft === null) return <><TopBar><a {...linkProps("/sent")}>Sent</a><Sep /><span className="here">Post a note</span></TopBar><div className="wp-page"><p className="wp-body">That note isn't here. It may have been discarded.</p></div></>;

  const names = chosen.map((p) => firstName(p.name ?? p.email));
  const toText = client ? `${client.name}${names.length ? ` · ${(picked ? chosen : withAccess).map((p) => p.name ?? p.email).join(", ")}` : " · no one with portal access yet"}` : "Pick a client";
  const toShort = client ? `${client.name}${names.length ? ` · ${names.join(", ")}` : ""}` : "Pick a client";
  const previewWho = names[0] ?? "Their";
  const button = link?.label ?? "Open in the portal";
  const previews = <><InboxPreview who={previewWho} title={title} detail={firstLine(text) || `A note from ${business}`} /><EmailPreview business={business} title={title} text={text} button={button} /></>;

  return (
    <>
      <TopBar right={fromClaude ? <StatusChip tone="accent">Draft</StatusChip> : undefined}><a {...linkProps("/sent")}>Sent</a><Sep /><span className="here">Post a note</span></TopBar>
      <div className="wp-page pn">
        <a className="wp-setback" {...linkProps(backTo.to)}><Icon name="arrow-left" size={20} />{backTo.label}</a>
        <header className="wp-pagehead"><div className="txt"><h1 className="wp-h2">Post a note.</h1><p className="wp-body pc-only">It lands in their Inbox, newest first.</p></div></header>
        <div className="pn-cols">
          <div className="col">
            {fromClaude && (
              <div className="wp-notice bad pn-claude" role="status">
                <Icon name="alert" size={20} />
                <span className="txt"><b>Drafted by Claude: confirm to send</b><span className="secondary"> Check the wording and who it goes to. Nothing goes out until you press Send note.</span></span>
              </div>
            )}
            <form className="pn-formwrap" onSubmit={(e) => { e.preventDefault(); askSend(); }}>
              <div className="pn-form glass">
              <div className="wp-field"><span className="wp-field-label">To</span>
                <button type="button" className="pn-to" onClick={() => setDialog("to")}>
                  <span className="v"><span className="pc-only">{toText}</span><span className="ph-only">{toShort}</span></span>
                  <span className="c">{client ? "Change" : "Pick"}</span>
                </button>
              </div>
              <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shoot moved to Thursday, Nov 6" maxLength={120} />
              <TextArea label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={2000} placeholder="What do they need to know?" />
              <div className="wp-field"><span className="wp-field-label pc-only">Link (optional)</span>
                {link ? (
                  <div className="pn-link"><Icon name={link.icon} size={18} /><span className="v">{link.box}</span><button type="button" className="btn ghost sm" onClick={() => setLink(null)}>Remove</button></div>
                ) : (
                  <div className="pn-attach">
                    <Button size="sm" disabled={!clientId} onClick={() => setDialog("cut")}>Attach a cut</Button>
                    <Button size="sm" disabled={!clientId} onClick={() => setDialog("doc")}>Attach a document</Button>
                  </div>
                )}
              </div>
              <hr className="wp-divider pc-only" />
              <label className="pn-email-toggle">
                <Toggle checked={emailThem} onChange={setEmailThem} label="Also email them" />
                <span className="t"><span>Also email them</span><span className="h pc-only">One email to each person, from {business}.{replyTo ? ` Replies go to ${replyTo}.` : ""}</span></span>
              </label>
              {err && <p className="error" role="alert">{err}</p>}
              <div className="pn-foot">
                <Button variant="ghost" loading={busy === "save"} disabled={!clientId || !title.trim() || !!busy} onClick={() => void doSave()}>Save draft</Button>
                <span className="sp" />
                <Button onClick={() => setDialog("preview")}>Preview</Button>
                <Button variant="primary" type="submit" disabled={!!busy}>Send note</Button>
              </div>
              </div>
              <div className="pn-phfoot">
                <Button onClick={() => setDialog("preview")}>Preview</Button>
                <Button variant="primary" type="submit" disabled={!!busy}>Send note</Button>
              </div>
            </form>
          </div>
          <div className="col right pc-only">{previews}</div>
        </div>
      </div>
      {dialog === "to" && <PickPeople clients={clients ?? []} clientId={clientId} setClientId={setClientId} people={people} picked={picked ?? new Set(withAccess.map((p) => p.email))} setPicked={setPicked} onClose={() => setDialog(null)} />}
      {(dialog === "cut" || dialog === "doc") && clientId && <AttachPicker kind={dialog} clientId={clientId} onPick={(l) => { setLink(l); setDialog(null); }} onClose={() => setDialog(null)} />}
      {dialog === "preview" && (
        <Modal onClose={() => setDialog(null)} label="Preview" width={460}>
          <div className="pn-pick"><DialogHeader eyebrow="Preview" title="As they'll see it." onClose={() => setDialog(null)} />{previews}</div>
        </Modal>
      )}
      {dialog === "confirm" && client && (
        <Modal onClose={() => setDialog(null)} label="Send this note" width={520}>
          <div className="pn-pick">
            <DialogHeader title={`Send this note to ${chosen.length} ${chosen.length === 1 ? "person" : "people"} at ${client.name}?`}
              body={`${andList(names)} will see it in their Inbox${emailThem ? " and get an email" : ""}.`} onClose={() => setDialog(null)} />
            <InboxPreview who={previewWho} title={title} detail={`A note from ${business}`} />
            <div className="dfoot"><Button onClick={() => setDialog(null)}>Back</Button><Button variant="primary" loading={busy === "send"} onClick={() => void doSend()}>Send note</Button></div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}
