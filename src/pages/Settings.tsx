// Settings: your profile, the Dropbox drop folder, and the Claude connector (keys + setup). Labels and members come with later phases.
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Copy, KeyRound, Monitor, Moon, Plus, Settings as SettingsIcon, Sheet, Sun, X } from "lucide-react";
import { useTheme, type ThemePref } from "../lib/theme";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { TopBar } from "../shell/Shell";
import { Avatar, Modal, useToast } from "../ui/kit";
import { ago } from "../lib/format";
import { DropboxSettings } from "./DropboxSettings";
import { ClientsSettings } from "./Clients";
import { SharesSettings } from "./Share";

// The connector lives on the Convex site host: <deployment>.convex.site/mcp
const CONVEX = (import.meta.env.VITE_CONVEX_URL as string | undefined) || "https://handsome-hummingbird-11.convex.cloud";
export const MCP_URL = CONVEX.replace(/\.convex\.cloud\/?$/, ".convex.site") + "/mcp";
const FEED_URL = CONVEX.replace(/\.convex\.cloud\/?$/, ".convex.site") + "/register-feed";

// The Apps Script that keeps the Google Sheet copy of the register up to date (pulls every 10 minutes).
function sheetScript(key: string) {
  return `// Wrangler Review register: copies the register into the "Register" tab every 10 minutes.
// Run setUp once (it asks for permission), then leave it. Edits in the sheet are overwritten; change things on the site.
const FEED = "${FEED_URL}";
const KEY = "${key}";

function refreshRegister() {
  const res = UrlFetchApp.fetch(FEED, { headers: { "X-Key": KEY }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("Wrangler Review feed answered " + res.getResponseCode() + ": " + res.getContentText().slice(0, 200));
  const data = JSON.parse(res.getContentText());
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Register") || ss.insertSheet("Register", 0);
  const cols = data.columns;
  const rows = data.rows.map(function (r) { return cols.map(function (c) { return r[c] === undefined || r[c] === null ? "" : r[c]; }); });
  sh.clearContents();
  sh.getRange(1, 1, Math.max(rows.length + 1, 2), 2).setNumberFormat("@"); // keep 00001 as text
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold");
  if (rows.length) sh.getRange(2, 1, rows.length, cols.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.getRange(1, cols.length + 2).setValue("Updated " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, h:mm a"));
}

function setUp() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "refreshRegister") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("refreshRegister").timeBased().everyMinutes(10).create();
  refreshRegister();
}
`;
}

// Light / Dark / System, kept per browser (this device only).
function Appearance() {
  const { pref, setPref } = useTheme();
  const opts: Array<{ v: ThemePref; label: string; icon: React.ReactNode }> = [
    { v: "light", label: "Light", icon: <Sun size={15} /> },
    { v: "dark", label: "Dark", icon: <Moon size={15} /> },
    { v: "system", label: "System", icon: <Monitor size={15} /> },
  ];
  return (
    <div className="panel">
      <div className="prow">
        <span className="pl">Appearance <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>System follows this device's light or dark setting.</span></span>
        <span className="pr">
          <span className="seg" role="radiogroup" aria-label="Appearance">
            {opts.map((o) => (
              <button key={o.v} role="radio" aria-checked={pref === o.v} className={`segbtn${pref === o.v ? " on" : ""}`} onClick={() => setPref(o.v)}>{o.icon}{o.label}</button>
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}

export async function copy(text: string, show: (m: string) => void, what = "Copied") {
  try { await navigator.clipboard.writeText(text); show(what); }
  catch { show("Couldn't copy. Select the text and copy it yourself."); }
}

export default function Settings({ me }: { me: { name: string | null; email: string } }) {
  const setName = useMutation(api.users.setName);
  const { signOut } = useAuthActions();
  const [name, setN] = useState(me.name ?? "");
  const [toast, show] = useToast();
  const changed = name.trim() !== (me.name ?? "") && name.trim().length > 0;
  return (
    <>
      <TopBar><SettingsIcon size={15} /><span className="here">Settings</span></TopBar>
      <div className="content">
        <div className="settings">
          <div style={{ display: "grid", gap: 8 }}>
            <span className="eyebrow">Account</span>
            <h1 className="headline">Your profile. <span className="rest">The name here goes on every note and reply you leave.</span></h1>
          </div>
          <div className="panel">
            <div className="prow">
              <span className="pl">Name</span>
              <span className="pr">
                <input className="input sm" value={name} onChange={(e) => setN(e.target.value)} placeholder="Heston" aria-label="Name" />
                {changed && <button className="btn primary sm" onClick={async () => { await setName({ name }); show("Name saved"); }}>Save</button>}
              </span>
            </div>
            <div className="prow"><span className="pl">Email</span><span className="pr secondary">{me.email}</span></div>
            <div className="prow"><span className="pl">Picture</span><span className="pr"><Avatar name={name || me.email} size="lg" /></span></div>
          </div>

          <Appearance />

          <DropboxSettings show={show} />

          <Connector show={show} />

          <SheetCopy show={show} />

          <ClientsSettings show={show} />

          <SharesSettings show={show} />

          <div className="panel">
            <div className="prow">
              <span className="pl">Sign out <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Ends this session on this device.</span></span>
              <span className="pr"><button className="btn sm" onClick={() => void signOut()}>Sign out</button></span>
            </div>
          </div>
        </div>
      </div>
      {toast}
    </>
  );
}

function Connector({ show }: { show: (m: string) => void }) {
  const keys = useQuery(api.connector.listKeys, {});
  const createKey = useAction(api.connector.createKey);
  const revokeKey = useMutation(api.connector.revokeKey);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<{ _id: Id<"connectorKeys">; prefix: string; label: string } | null>(null);

  const make = async () => {
    setBusy(true);
    try { setMade((await createKey({ label: "Claude" })).key); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ display: "grid", gap: 8 }} id="claude">
        <span className="eyebrow">Claude connector</span>
        <h1 className="headline">Claude reads your notes. <span className="rest">Connect once, then tell Claude you left notes, in any chat on your desktop or phone.</span></h1>
      </div>

      <div className="panel">
        <div className="prow">
          <span className="pl">Connector address</span>
          <span className="pr">
            <code className="mono addr">{MCP_URL}</code>
            <button className="icon-btn" onClick={() => void copy(MCP_URL, show, "Address copied")} aria-label="Copy the connector address" title="Copy"><Copy size={15} /></button>
          </span>
        </div>
        <div className="prow">
          <span className="pl">Keys <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>Claude sends a key with every request. Revoke one and it stops working right away.</span></span>
          <span className="pr"><button className="btn primary sm" disabled={busy} onClick={() => void make()}><Plus size={15} />{busy ? "Making…" : "Create key"}</button></span>
        </div>
        {keys === undefined ? null : keys.length === 0 ? (
          <div className="prow"><span className="pl secondary">No keys yet.</span></div>
        ) : keys.map((k) => (
          <div className="prow keyrow" key={k._id}>
            <KeyRound size={16} />
            <span className="pl">
              <b>{k.label}</b> <code className="mono">{k.prefix}…</code>
              <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>
                Made {ago(k.createdAt)} · {k.lastUsedAt ? <>last used {ago(k.lastUsedAt)}</> : "not used yet"}
              </span>
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
          <li>Name it <b>Wrangler Review</b> and paste the connector address.</li>
          <li>For sign-in, pick <b>No sign-in</b>. Under <b>Request headers</b>, choose <code className="mono">authorization</code> and paste <code className="mono">Bearer</code>, a space, then your key.</li>
          <li>No <b>Request headers</b> section? Use the address with the key on the end instead. The key window gives you that one too.</li>
          <li>In a chat, turn it on from <b>+ › Connectors</b>, then try: “I left notes on the Spirit intro.”</li>
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
            <KeyLine label="No Request headers in Claude? Use this address" value={`${MCP_URL}/${made}`} onCopy={(v) => void copy(v, show, "Address copied")} />
            <p className="caption secondary" style={{ margin: 0 }}>Keep it out of chats, email and screenshots. Anyone with it can read and reply to notes on this site.</p>
            <div className="dfoot"><button className="btn primary" onClick={() => setMade(null)}>Done</button></div>
          </div>
        </Modal>
      )}

      {revoking && (
        <Modal onClose={() => setRevoking(null)} label="Revoke key" width={460}>
          <div style={{ display: "grid", gap: 18 }}>
            <div className="dhead">
              <h2 className="headline">Revoke {revoking.prefix}…? <span className="rest">Claude stops reaching the site with this key right away. You can make a new one any time.</span></h2>
              <button className="icon-btn" onClick={() => setRevoking(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="dfoot">
              <button className="btn" onClick={() => setRevoking(null)}>Cancel</button>
              <button className="btn primary" onClick={async () => { await revokeKey({ keyId: revoking._id }); setRevoking(null); show("Key revoked"); }}>Revoke</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export function KeyLine({ label, value, onCopy }: { label: string; value: string; onCopy: (v: string) => void }) {
  return (
    <div className="keyline rect">
      <span className="rlabel">{label}</span>
      <div className="kv">
        <code className="mono" onClick={(e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }}>{value}</code>
        <button className="icon-btn" onClick={() => onCopy(value)} aria-label={`Copy: ${label}`} title="Copy"><Copy size={15} /></button>
      </div>
    </div>
  );
}

function SheetCopy({ show }: { show: (m: string) => void }) {
  const status = useQuery(api.register.sheetKey, {});
  const makeKey = useAction(api.register.makeSheetKey);
  const removeKey = useMutation(api.register.removeSheetKey);
  const [script, setScript] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { setScript(sheetScript((await makeKey({})).key)); }
    catch (e) { show((e as Error).message.replace(/^.*ConvexError: /, "").split("\n")[0]); }
    finally { setBusy(false); }
  };
  return (
    <>
      <div style={{ display: "grid", gap: 8 }} id="sheet">
        <span className="eyebrow">Google Sheet copy</span>
        <h1 className="headline">The register in a Google Sheet. <span className="rest">A copy that refreshes itself every 10 minutes. Changes happen here, not in the sheet.</span></h1>
      </div>
      <div className="panel">
        <div className="prow">
          <span className="pl">
            Sheet key
            <span className="secondary" style={{ display: "block", fontSize: 12.5 }}>
              {status === undefined ? "…" : status ? <>Key <code className="mono">{status.prefix}…</code> made {ago(status.createdAt)} · {status.lastUsedAt ? <>sheet last refreshed {ago(status.lastUsedAt)}</> : "not used yet"}</> : "No key yet. The sheet reads the register with it, and can't change anything."}
            </span>
          </span>
          <span className="pr">
            {status && <button className="btn sm" onClick={async () => { await removeKey({}); show("Sheet key removed. The sheet stops refreshing."); }}>Turn off</button>}
            <button className="btn primary sm" disabled={busy} onClick={() => void make()}><Sheet size={15} />{busy ? "Making…" : status ? "New key and script" : "Set up the sheet"}</button>
          </span>
        </div>
      </div>
      {script && (
        <Modal onClose={() => setScript(null)} label="Google Sheet script" width={640}>
          <div style={{ display: "grid", gap: 16 }}>
            <div className="dhead">
              <h2 className="headline">Your sheet script. <span className="rest">Its key is inside. Copy it now; it won't be shown again.</span></h2>
              <button className="icon-btn" onClick={() => setScript(null)} aria-label="Close"><X size={18} /></button>
            </div>
            <ol className="steps">
              <li>Make a Google Sheet (<b>sheets.new</b>) and name it <b>Wrangler Review Register</b>.</li>
              <li>In the sheet, open <b>Extensions › Apps Script</b>. Delete what's in the editor, paste the script, and press <b>Save</b>.</li>
              <li>Pick <b>setUp</b> in the function menu at the top, then press <b>Run</b>. Allow access when Google asks: <b>Review permissions</b>, your account, <b>Advanced</b>, then <b>Go to … (unsafe)</b> and <b>Allow</b>. It's your own script.</li>
              <li>Back in the sheet, the <b>Register</b> tab fills in. It refreshes every 10 minutes on its own.</li>
            </ol>
            <div className="keyline rect">
              <span className="rlabel">Apps Script</span>
              <pre className="mono scriptbox">{script}</pre>
            </div>
            <p className="caption secondary" style={{ margin: 0 }}>Keep the script out of chats and email. The key only reads the register, and you can turn it off here any time. Making a new key stops the old one.</p>
            <div className="dfoot">
              <button className="btn" onClick={() => setScript(null)}>Done</button>
              <button className="btn primary" onClick={() => void copy(script, show, "Script copied")}><Copy size={15} />Copy script</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
