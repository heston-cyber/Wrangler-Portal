// Phase 8a (Heston, Nov 18, D207): Settings › Claude connectors, the one Wrangler Portal connector. The owner only makes
// its keys. Same layout as the old Review and Sign panels (frame 99-891), which went in Phase 8f (Nov 19): this is the
// only connector.
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, KeyRound, Plus, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Modal } from "../../ui/kit";
import { ago } from "../../lib/format";
import { copy, KeyLine, PORTAL_MCP_URL as CONNECTOR_URL } from "./Settings";


export function PortalConnectorPanel({ show }: { show: (m: string) => void }) {
  const PORTAL_MCP_URL = CONNECTOR_URL; // read at render: Settings.tsx imports this file too
  const keys = useQuery(api.portalKeys.listKeys, {});
  const createKey = useAction(api.portalKeys.createKey);
  const revokeKey = useMutation(api.portalKeys.revokeKey);
  const [made, setMade] = useState<string | null>(null);
  // 8d: how long a new key works (Heston to confirm the start: 90 days).
  const [days, setDays] = useState<30 | 90 | 365 | null>(90);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<{ _id: string; prefix: string; label: string } | null>(null);
  const make = async () => {
    setBusy(true);
    try { setMade((await createKey({ label: "Claude", days })).key); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div className="wp-setsub" id="portal">
        <span className="eyebrow">Wrangler Portal</span>
        <p>Run the whole portal from Claude. It makes changes directly; anything sent to someone, or deleted, waits for you to press Confirm here.</p>
      </div>
      <div className="panel">
        <div className="prow">
          <span className="pl">Connector address</span>
          <span className="pr">
            <code className="mono addr">{PORTAL_MCP_URL}</code>
            <button className="icon-btn" onClick={() => void copy(PORTAL_MCP_URL, show, "Address copied")} aria-label="Copy the connector address" title="Copy"><Copy size={15} /></button>
          </span>
        </div>
        <div className="prow">
          <span className="pl">Keys <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Only you can make one. Claude sends it with every request; revoke one and it stops working right away.</span></span>
          <span className="pr">
            <select className="input sm" value={days ?? "never"} onChange={(e) => setDays(e.target.value === "never" ? null : (Number(e.target.value) as 30 | 90 | 365))} aria-label="How long the new key works">
              <option value="30">Works 30 days</option><option value="90">Works 90 days</option><option value="365">Works a year</option><option value="never">Works until revoked</option>
            </select>
            <button className="btn primary sm" disabled={busy} onClick={() => void make()}><Plus size={15} />{busy ? "Making…" : "Create key"}</button>
          </span>
        </div>
        {keys === undefined ? null : keys.length === 0 ? (
          <div className="prow"><span className="pl secondary">No keys yet.</span></div>
        ) : keys.map((k) => (
          <div className="prow keyrow" key={k._id}>
            <KeyRound size={16} />
            <span className="pl">
              <b>{k.label}</b> <code className="mono">{k.prefix}…</code>
              <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Made {ago(k.createdAt)} · {k.lastUsedAt ? <>last used {ago(k.lastUsedAt)}</> : "not used yet"} · {k.expired ? (k.expiresAt ? "ran out: make a new one" : "made before Nov 19, no longer works: make a new one") : k.expiresAt ? `works until ${new Date(k.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "works until revoked"}</span>
            </span>
            <span className="pr"><button className="btn sm" onClick={() => setRevoking(k)}>Revoke</button></span>
          </div>
        ))}
      </div>
      <div className="panel setup">
        <div className="prow"><span className="pl"><b>Set up in Claude</b> <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Once, on claude.ai or the desktop app. Your phone picks it up from your account.</span></span></div>
        <ol className="steps">
          <li>Make a key above and copy it. It's shown once.</li>
          <li>In Claude, open <b>Customize › Connectors</b>, then <b>Add custom connector</b>.</li>
          <li>Name it <b>Wrangler Portal</b> and paste the connector address.</li>
          <li>For sign-in, pick <b>No sign-in</b>. Under <b>Request headers</b>, choose <code className="mono">authorization</code> and paste <code className="mono">Bearer</code>, a space, then your key.</li>
          <li>No <b>Request headers</b> section? Use the address with the key on the end instead. The key window gives you that one too.</li>
          <li>In a chat, turn it on from <b>+ › Connectors</b>, then try: “What can the Wrangler Portal connector do?”</li>
        </ol>
      </div>
      {made && (
        <Modal onClose={() => setMade(null)} label="Your connector key" width={560}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Your key. <span className="rest">Copy it now. It won't be shown again.</span></h2>
              <button className="icon-btn" onClick={() => setMade(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <KeyLine label="Request header value (for authorization)" value={`Bearer ${made}`} onCopy={(v) => void copy(v, show, "Header value copied")} />
            <KeyLine label="Key only" value={made} onCopy={(v) => void copy(v, show, "Key copied")} />
            <KeyLine label="No Request headers in Claude? Use this address" value={`${PORTAL_MCP_URL}/${made}`} onCopy={(v) => void copy(v, show, "Address copied")} />
            <p className="caption secondary" style={{ margin: 0 }}>Keep it out of chats, email and screenshots. Anyone with it can run your portal (sending and deleting still wait for you).</p>
            <div className="dfoot"><button className="btn primary" onClick={() => setMade(null)}>Done</button></div>
          </div>
        </Modal>
      )}
      {revoking && (
        <Modal onClose={() => setRevoking(null)} label="Revoke key" width={460}>
          <div style={{ display: "grid", gap: 14 }}>
            <h2 className="headline">Revoke {revoking.prefix}…?</h2>
            <p className="secondary" style={{ margin: 0 }}>Claude stops reaching the portal with this key right away. You can make a new one any time.</p>
            <div className="dfoot">
              <button className="btn ghost" onClick={() => setRevoking(null)}>Cancel</button>
              <button className="btn primary" onClick={() => void revokeKey({ keyId: revoking._id }).then(() => { show("Key revoked"); setRevoking(null); }, (e) => show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]))}>Revoke</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
