// Notices shown on the Contracts front page: adopt your signature first; connect the Dropbox archive.
import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Icon } from "../../../ui/Icon";
import { Button, ButtonLink } from "../../../ui/wp";
import { errText } from "./common";
import { ClaudeRequestNotices } from "./ClaudeRequests";

export function SignNotices() {
  const sig = useQuery(api.sign.ownerSignature);
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
      <ClaudeRequestNotices />
      {sig && !sig.adopted && (
        <div className="wp-notice" role="status"><Icon name="sign" size={20} /><span className="txt"><b>Adopt your signature first.</b> It goes on every document you send.</span><ButtonLink size="sm" to="/sign/signature">Set it up</ButtonLink></div>
      )}
      {note && <div className="wp-notice" role="status"><Icon name="folder" size={20} /><span className="txt">{note}</span></div>}
      {archive && !archive.connected && (
        <div className="wp-notice" role="status">
          <Icon name="folder" size={20} />
          {archive.configured
            ? <><span className="txt"><b>Connect the archive.</b> Signed copies and their audit records are also kept in Dropbox › Apps/Wrangler Sign.</span><Button size="sm" loading={connecting} onClick={() => void onConnect()}>Connect Dropbox</Button></>
            : <span className="txt"><b>The archive isn't set up yet.</b> Signed copies are kept here and emailed; the Dropbox copy starts once the "Wrangler Sign" Dropbox app's keys are in Convex.</span>}
        </div>
      )}
    </>
  );
}
