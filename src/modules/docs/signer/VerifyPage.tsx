// sign.wranglerportal.com/verify (Phase S3): is this PDF a real, unchanged Wrangler Sign signed copy?
// The file is hashed here in the browser (SHA-256); only the 64-character fingerprint is sent to be looked up.
import { useEffect, useRef, useState } from "react";
import { BrandImg } from "../../../ui/BrandImg";
import { Spinner } from "../../../ui/kit";
import { Icon } from "../../../ui/Icon";
import smear from "../../../assets/portal/light-smear.jpg";
import { CONVEX_SITE } from "../lib/client";

type Result = { match: true; label: string; title: string; completed: string; signers: string[] } | { match: false } | { error: string };

async function sha256(file: File) {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VerifyPage() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<{ name: string; sha: string } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  useEffect(() => { document.title = "Check a signed copy · Wrangler Sign"; }, []);
  const check = async (f: File) => {
    setBusy(true); setRes(null);
    try {
      const sha = await sha256(f);
      setFile({ name: f.name, sha });
      const r = await fetch(`${CONVEX_SITE}/ws-verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha }) });
      setRes((await r.json()) as Result);
    } catch { setRes({ error: "Couldn't check right now. Try again in a minute." }); }
    finally { setBusy(false); }
  };
  return (
    <div className="wsx">
      <div className="wp-light signing" aria-hidden><i style={{ backgroundImage: `url(${smear})` }} /></div>
      <header className="wsx-top"><BrandImg name="wordmark" alt="Wrangler Productions" /><span className="wsx-secure"><Icon name="lock" size={14} />Wrangler Sign</span></header>
      <main className="wsx-main">
        <div className="wsx-card glass">
          <Icon name="sign" size={24} />
          <h1 className="headline">Check a signed copy</h1>
          <p className="caption">Choose a PDF signed with Wrangler Sign. This page works out its fingerprint (SHA-256) on your device and checks it against our records. The file itself isn't uploaded.</p>
          <div className={`ws-drop wsx-drop${over ? " over" : ""}`} role="button" tabIndex={0} onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void check(f); }}>
            {busy ? <><Spinner size={16} /> Checking…</> : <><Icon name="upload" size={20} /><span>Drop the PDF here, or tap to choose it.</span></>}
          </div>
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void check(f); }} />
          {res && "match" in res && res.match && (
            <div className="wsx-result ok">
              <p className="caption head"><Icon name="check-circle" size={16} plain /> <b>This is a genuine, unchanged signed copy.</b></p>
              <p className="caption">{res.label} · "{res.title}"<br />Signed by everyone on {res.completed}: {res.signers.join(", ")}.</p>
            </div>
          )}
          {res && "match" in res && !res.match && (
            <div className="wsx-result bad">
              <p className="caption"><Icon name="alert" size={16} /> <b>No match.</b> This file isn't a Wrangler Sign signed copy, or it has been changed since it was signed (even re-saving it changes the fingerprint). Use the PDF from the "Signed:" email.</p>
            </div>
          )}
          {res && "error" in res && <p className="caption wsx-err"><Icon name="alert" size={14} /> {res.error}</p>}
          {file && <p className="caption secondary wsx-small" style={{ overflowWrap: "anywhere" }}>{file.name} · SHA-256 {file.sha}</p>}
        </div>
      </main>
      <footer className="wsx-foot">Wrangler Productions, a DBA of Hill Creative LLC</footer>
    </div>
  );
}
