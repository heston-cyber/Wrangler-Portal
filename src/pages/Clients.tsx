// Settings › Clients (C1, Oct 23): the emails invited to make a client account. The Share dialog (C2) invites too.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { UserPlus, UserX } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { ago } from "../lib/format";

export function ClientsSettings({ show }: { show: (m: string) => void }) {
  const invites = useQuery(api.clients.listInvites, {});
  const invite = useMutation(api.clients.invite);
  const revoke = useMutation(api.clients.revokeInvite);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const live = (invites ?? []).filter((i) => !i.revokedAt);
  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    try { const r = await invite({ email, name: name || undefined }); show(r.already ? "Already invited" : "Invited"); setEmail(""); setName(""); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: "grid", gap: 8 }} id="clients">
        <span className="eyebrow">Clients</span>
        <h1 className="headline">Who can make an account. <span className="rest">An invited email can set a password and sign in. They see only what you share with them (sharing arrives in the next phase).</span></h1>
      </div>
      <div className="panel">
        <div className="prow">
          <span className="pl">Invite an email</span>
          <span className="pr" style={{ gap: 8, flexWrap: "wrap" }}>
            <input className="input sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Name" style={{ width: 150 }} />
            <input className="input sm" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@client.com" type="email" aria-label="Email" style={{ width: 220 }} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
            <button className="btn primary sm" disabled={busy || !email.trim()} onClick={() => void add()}><UserPlus size={14} />Invite</button>
          </span>
        </div>
        {invites === undefined ? null : live.length === 0 ? (
          <div className="prow"><span className="pl secondary">No one invited yet.</span></div>
        ) : live.map((i) => (
          <div className="prow" key={i._id}>
            <span className="pl">
              {i.name ? <>{i.name} <span className="secondary">· {i.email}</span></> : i.email}
              <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>
                {i.acceptedAt ? `Account made ${ago(i.acceptedAt)}${i.lastSignInAt ? ` · last signed in ${ago(i.lastSignInAt)}` : ""}` : `Invited ${ago(i.createdAt)} · no account yet`}
                {(i.emails.versionsOff || i.emails.repliesOff) && <> · stopped emails about {[i.emails.versionsOff && "new versions", i.emails.repliesOff && "replies"].filter(Boolean).join(" and ")}</>}
              </span>
            </span>
            <span className="pr"><button className="btn sm" onClick={async () => { await revoke({ inviteId: i._id }); show("Invite removed"); }}><UserX size={14} />Remove</button></span>
          </div>
        ))}
      </div>
    </>
  );
}
