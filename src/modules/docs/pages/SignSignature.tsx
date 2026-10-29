// Your signature: Heston adopts the signature and initials that go on documents he sends. Phase S1, Oct 27.
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps } from "../../../lib/router";
import { useToast } from "../../../ui/kit";
import { SignaturePad, type PadResult } from "../lib/SignaturePad";
import { central, errText, uploadToStorage } from "./common";
import { Button, PageHeader, SkeletonRows } from "../../../ui/wp";

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
      <TopBar><a {...linkProps("/sign")}>Docs</a><Sep /><span className="here">Your signature</span></TopBar>
      <div className="wp-page docs">
        <PageHeader eyebrow="Wrangler Sign" title="Your signature." sub="It goes on every document you approve and send, as Wrangler Productions, a DBA of Hill Creative LLC." />

        {cur === undefined ? <div className="wp-tablecard glass"><SkeletonRows n={2} /></div> : cur.adopted && !editing ? (
          <div className="ws-sigcard glass">
            <div className="ws-sigimgs">
              {cur.signatureUrl && <span className="box sig"><img src={cur.signatureUrl} alt="Your adopted signature" className="ws-sigimg" /></span>}
              {cur.initialsUrl && <span className="box ini"><img src={cur.initialsUrl} alt="Your adopted initials" className="ws-iniimg" /></span>}
            </div>
            <p className="who">{cur.name}, {cur.title} · {cur.email}</p>
            <p className="wp-small meta">Adopted {central(cur.adoptedAt)} · {cur.method === "typed" ? "typed" : "drawn"} · SHA-256 {cur.signatureSha256.slice(0, 16)}…</p>
            <div><Button size="sm" onClick={() => setEditing(true)}>Change it</Button></div>
            <p className="wp-small foot">Changing it doesn't touch documents already sent; each one records the signature it was sent with.</p>
          </div>
        ) : null}

        {showForm && (
          <div className="ws-sigform glass">
            <div className="ws-row2">
              <label className="wp-field"><span className="wp-field-label">Full name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" /></label>
              <label className="wp-field"><span className="wp-field-label">Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
            </div>
            <SignaturePad name={name} onResult={setPad} />
            <label className="ws-agree">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>This is my electronic signature and initials. Wrangler Sign will place them on documents I approve and send, and that has the same effect as signing by hand.</span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="primary" loading={busy} disabled={!pad || !agree || !name.trim()} onClick={() => void save()}>Adopt this signature</Button>
              {cur?.adopted && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </div>
        )}
      </div>
      {toast}
    </>
  );
}
