// Contracts › Claude connector (Wrangler Sign, Phase S4): its own address and keys, separate from Wrangler Review's.
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, FileSignature, KeyRound, Plus, X } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Sep, TopBar } from "../../../shell/Shell";
import { linkProps } from "../../../lib/router";
import { Modal, useToast } from "../../../ui/kit";
import { ago } from "../../../lib/format";
import { copy, KeyLine } from "../../settings/Settings";
import { CONVEX_SITE } from "../lib/client";

export const WS_MCP_URL = `${CONVEX_SITE}/ws-mcp`;

export default function SignConnector() {
  const [toast, show] = useToast();
  const keys = useQuery(api.wsConnector.listKeys, {});
  const createKey = useAction(api.wsConnector.createKey);
  const revokeKey = useMutation(api.wsConnector.revokeKey);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<{ _id: Id<"wsConnectorKeys">; prefix: string } | null>(null);
  const make = async () => {
    setBusy(true);
    try { setMade((await createKey({ label: "Claude" })).key); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };
  return (
    <>
      <TopBar><FileSignature size={15} /><a {...linkProps("/sign")}>Contracts</a><Sep /><span className="here">Claude connector</span></TopBar>
      <div className="content">
        <div className="ws-list">
          <div style={{ display: "grid", gap: 8 }}>
            <span className="eyebrow">Wrangler Sign</span>
            <h1 className="headline">Claude sets up your contracts. <span className="rest">It uploads a contract you wrote together, places the boxes and shows you a preview. It approves, sends or cancels only when you say so in the chat.</span></h1>
          </div>
          <div className="panel">
            <div className="prow">
              <span className="pl">Connector address</span>
              <span className="pr"><code className="mono addr">{WS_MCP_URL}</code><button className="icon-btn" onClick={() => void copy(WS_MCP_URL, show, "Address copied")} aria-label="Copy the connector address" title="Copy"><Copy size={15} /></button></span>
            </div>
            <div className="prow">
              <span className="pl">Keys <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Separate from the Wrangler Review connector's keys. Revoke one and it stops working right away.</span></span>
              <span className="pr"><button className="btn primary sm" disabled={busy} onClick={() => void make()}><Plus size={15} />{busy ? "Making…" : "Create key"}</button></span>
            </div>
            {keys === undefined ? null : keys.length === 0 ? <div className="prow"><span className="pl secondary">No keys yet.</span></div> : keys.map((k) => (
              <div className="prow keyrow" key={k._id}>
                <KeyRound size={16} />
                <span className="pl"><b>{k.label}</b> <code className="mono">{k.prefix}…</code><span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Made {ago(k.createdAt)} · {k.lastUsedAt ? <>last used {ago(k.lastUsedAt)}</> : "not used yet"}</span></span>
                <span className="pr"><button className="btn sm" onClick={() => setRevoking(k)}>Revoke</button></span>
              </div>
            ))}
          </div>
          <div className="panel setup">
            <div className="prow"><span className="pl"><b>Set up in Claude</b> <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Once. Your phone picks it up from your account.</span></span></div>
            <ol className="steps">
              <li>Make a key above and copy it. It's shown once.</li>
              <li>In Claude, open <b>Customize › Connectors</b>, then <b>Add custom connector</b>.</li>
              <li>Name it <b>Wrangler Sign</b> and paste the connector address.</li>
              <li>For sign-in, pick <b>No sign-in</b>. Under <b>Request headers</b>, choose <code className="mono">authorization</code> and paste <code className="mono">Bearer</code>, a space, then your key. (No Request headers section? Use the address with the key on the end; the key window gives you that.)</li>
              <li>In a chat, turn it on from <b>+ › Connectors</b>, then try: “What contracts are out for signature?”</li>
            </ol>
          </div>
        </div>
      </div>
      {made && (
        <Modal onClose={() => setMade(null)} label="Your connector key" width={560}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead"><h2 className="headline">Your key. <span className="rest">Copy it now. It won't be shown again.</span></h2><button className="icon-btn" onClick={() => setMade(null)} aria-label="Close"><X size={18} /></button></div>
            <KeyLine label="Request header value (for authorization)" value={`Bearer ${made}`} onCopy={(v) => void copy(v, show, "Header value copied")} />
            <KeyLine label="Key only" value={made} onCopy={(v) => void copy(v, show, "Key copied")} />
            <KeyLine label="No Request headers in Claude? Use this address" value={`${WS_MCP_URL}/${made}`} onCopy={(v) => void copy(v, show, "Address copied")} />
            <p className="caption secondary" style={{ margin: 0 }}>Keep it out of chats, email and screenshots. Anyone with it can create and read your contracts (approving and sending also need it).</p>
            <div className="dfoot"><button className="btn primary" onClick={() => setMade(null)}>Done</button></div>
          </div>
        </Modal>
      )}
      {revoking && (
        <Modal onClose={() => setRevoking(null)} label="Revoke key" width={460}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead"><h2 className="headline">Revoke {revoking.prefix}…? <span className="rest">Claude stops reaching Wrangler Sign with this key right away.</span></h2><button className="icon-btn" onClick={() => setRevoking(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="dfoot"><button className="btn" onClick={() => setRevoking(null)}>Cancel</button><button className="btn primary" onClick={async () => { await revokeKey({ keyId: revoking._id }); setRevoking(null); show("Key revoked"); }}>Revoke</button></div>
          </div>
        </Modal>
      )}
      {toast}
    </>
  );
}
