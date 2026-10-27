// Contracts: every Wrangler Sign document, and "New document" (upload a finished PDF). Phase S1, Oct 27.
import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Archive, FilePlus2, FileSignature, PenLine } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { TopBar } from "../../shell/Shell";
import { linkProps, navigate } from "../../lib/router";
import { Spinner, useToast } from "../../ui/kit";
import { central, errText, StatusChip, uploadToStorage } from "./common";

export function useNewDocument() {
  const uploadUrl = useMutation(api.sign.uploadUrl);
  const create = useAction(api.sign.create);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, show] = useToast();
  const start = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { show("Choose a PDF."); return; }
    if (file.size > 25 * 1024 * 1024) { show("That PDF is over 25 MB."); return; }
    setBusy(file.name);
    try {
      const storageId = await uploadToStorage(await uploadUrl({}), file);
      const { documentId } = await create({ storageId, fileName: file.name });
      navigate(`/sign/d/${documentId}`);
    } catch (e) { show(errText(e)); }
    finally { setBusy(null); }
  };
  return { start, busy, toast };
}

export default function SignList() {
  const docs = useQuery(api.sign.list);
  const sig = useQuery(api.sign.ownerSignature);
  const input = useRef<HTMLInputElement>(null);
  const { start, busy, toast } = useNewDocument();
  const [over, setOver] = useState(false);
  const pick = () => input.current?.click();
  const archive = useQuery(api.wsArchive.status);
  const connect = useAction(api.wsArchive.authUrl);
  const [connecting, setConnecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Back from Dropbox: ?archive=connected or ?archive=error&reason=…
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const a = q.get("archive");
    if (!a) return;
    setNote(a === "connected" ? "Archive connected. Any signed documents not archived yet are being copied now." : `The archive didn't connect: ${q.get("reason") ?? "unknown"}`);
    history.replaceState(null, "", "/sign");
  }, []);
  const onConnect = async () => { setConnecting(true); try { location.href = await connect({}); } catch (e) { setNote(errText(e)); setConnecting(false); } };

  return (
    <>
      <TopBar right={<>
        <a className="btn ghost sm" {...linkProps("/sign/signature")}><PenLine size={15} />Your signature</a>
        <button className="btn primary sm" onClick={pick} disabled={!!busy}>{busy ? <Spinner /> : <FilePlus2 size={15} />}New document</button>
      </>}>
        <FileSignature size={15} /><span className="here">Contracts</span>
      </TopBar>
      <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void start(f); }} />
      <div className="content"
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void start(f); }}>
        <div className="ws-list">
          <div className="reghead">
            <div>
              <span className="eyebrow">Wrangler Sign</span>
              <h1 className="headline">Contracts. <span className="rest">Upload a finished PDF, place the signature boxes, approve it, and send it to sign.</span></h1>
            </div>
          </div>

          {sig && !sig.adopted && (
            <div className="ws-note" role="status">
              <PenLine size={16} />
              <span><b>Adopt your signature first.</b> It goes on every document you send.</span>
              <a className="btn sm" {...linkProps("/sign/signature")}>Set it up</a>
            </div>
          )}

          {note && <div className="ws-note" role="status"><Archive size={16} /><span>{note}</span></div>}
          {archive && !archive.connected && (
            <div className="ws-note" role="status">
              <Archive size={16} />
              {archive.configured
                ? <><span><b>Connect the archive.</b> Signed copies and their audit records are also kept in Dropbox › Apps/Wrangler Sign.</span><button className="btn sm" disabled={connecting} onClick={() => void onConnect()}>{connecting ? <Spinner /> : null}Connect Dropbox</button></>
                : <span><b>The archive isn't set up yet.</b> Signed copies are kept here and emailed; the Dropbox copy starts once the "Wrangler Sign" Dropbox app's keys are in Convex.</span>}
            </div>
          )}
          <div className={`ws-drop${over ? " over" : ""}`} onClick={pick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") pick(); }}>
            {busy ? <><Spinner size={16} /> Uploading {busy}…</> : <><FilePlus2 size={18} /> Drop a finished PDF here, or click to choose one. Markers like <code>{"{{sign:client}}"}</code> place the boxes for you.</>}
          </div>

          {docs === undefined ? <p className="caption" style={{ padding: 18 }}>Loading…</p>
            : docs.length === 0 ? <div className="empty">No documents yet.</div>
            : (
              <div className="regwrap">
                <table className="regtable ws-table">
                  <thead><tr><th scope="col">No.</th><th scope="col">Document</th><th scope="col" className="hide-sm">Signers</th><th scope="col">Status</th><th scope="col" className="hide-sm">Updated</th></tr></thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d._id} onClick={() => navigate(`/sign/d/${d._id}`)} style={{ cursor: "pointer" }}>
                        <td className="num mono">{d.label}</td>
                        <td><a {...linkProps(`/sign/d/${d._id}`)} onClick={(e) => e.stopPropagation()}>{d.title}</a> <span className="secondary">· v{d.version} · {d.pages} page{d.pages === 1 ? "" : "s"}</span></td>
                        <td className="hide-sm secondary">{d.signers.filter(Boolean).join(", ") || "—"}</td>
                        <td><StatusChip status={d.status} /></td>
                        <td className="hide-sm secondary">{central(d.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
      {toast}
    </>
  );
}
