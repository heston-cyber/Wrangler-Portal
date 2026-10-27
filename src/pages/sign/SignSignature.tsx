// Your signature: Heston adopts the signature and initials that go on documents he sends. Phase S1, Oct 27.
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { FileSignature, PenLine } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Sep, TopBar } from "../../shell/Shell";
import { linkProps } from "../../lib/router";
import { Spinner, useToast } from "../../ui/kit";
import { SignaturePad, type PadResult } from "../../sign/SignaturePad";
import { central, errText, uploadToStorage } from "./common";

export default function SignSignature() {
  const cur = useQuery(api.sign.ownerSignature);
  const uploadUrl = useMutation(api.sign.uploadUrl);
  const adopt = useAction(api.sign.adoptSignature);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [pad, setPad] = useState<PadResult | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toast, show] = useToast();
  useEffect(() => {
    if (!cur) return;
    setName((n) => n || (cur.adopted ? cur.name : "Heston Hill"));
    setTitle((t) => t || (cur.adopted ? cur.title : "Founder"));
  }, [cur]);

  const save = async () => {
    if (!pad) return;
    setBusy(true);
    try {
      const [a, b] = await Promise.all([uploadToStorage(await uploadUrl({}), pad.signature), uploadToStorage(await uploadUrl({}), pad.initials)]);
      await adopt({ name, title, method: pad.method, signatureStorageId: a, initialsStorageId: b });
      show("Signature adopted");
      setEditing(false); setAgree(false);
    } catch (e) { show(errText(e)); }
    finally { setBusy(false); }
  };

  const showForm = cur !== undefined && (!cur.adopted || editing);
  return (
    <>
      <TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep /><span className="here">Your signature</span></TopBar>
      <div className="content">
        <div className="ws-sigpage">
          <span className="eyebrow">Wrangler Sign</span>
          <h1 className="headline">Your signature. <span className="rest">It goes on every document you approve and send, as Wrangler Productions, a DBA of Hill Creative LLC.</span></h1>

          {cur === undefined ? <p className="caption">Loading…</p> : cur.adopted && !editing ? (
            <div className="ws-sigcard">
              <div className="ws-sigimgs">
                {cur.signatureUrl && <img src={cur.signatureUrl} alt="Your adopted signature" className="ws-sigimg" />}
                {cur.initialsUrl && <img src={cur.initialsUrl} alt="Your adopted initials" className="ws-iniimg" />}
              </div>
              <p className="caption"><b>{cur.name}</b>, {cur.title} · {cur.email}<br /><span className="secondary">Adopted {central(cur.adoptedAt)} · {cur.method === "typed" ? "typed" : "drawn"} · SHA-256 {cur.signatureSha256.slice(0, 16)}…</span></p>
              <button className="btn sm" onClick={() => setEditing(true)}><PenLine size={14} />Change it</button>
              <p className="caption secondary">Changing it doesn't touch documents already sent; each one records the signature it was sent with.</p>
            </div>
          ) : null}

          {showForm && (
            <div className="ws-sigform">
              <div className="ws-row2">
                <label className="field"><span className="label">Full name</span><input className="input sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></label>
                <label className="field"><span className="label">Title</span><input className="input sm" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
              </div>
              <SignaturePad name={name} onResult={setPad} />
              <label className="ws-agree">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>This is my electronic signature and initials. Wrangler Sign will place them on documents I approve and send, and that has the same effect as signing by hand.</span>
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" disabled={!pad || !agree || !name.trim() || busy} onClick={() => void save()}>{busy ? <Spinner /> : null}Adopt this signature</button>
                {cur?.adopted && <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>}
              </div>
            </div>
          )}
        </div>
      </div>
      {toast}
    </>
  );
}
