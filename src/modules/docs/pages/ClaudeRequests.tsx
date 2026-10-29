// Security review (Oct 27): what Claude asked to do through the connector. Approve, send and cancel only happen when
// Heston confirms here, signed in; Claude's call just leaves the request.
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Bot, Check, X } from "lucide-react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Icon } from "../../../ui/Icon";
import { ButtonLink } from "../../../ui/wp";
import { Spinner } from "../../../ui/kit";
import { central, errText } from "./common";

const VERB = { approve: "approve and lock", send: "send for signature", cancel: "cancel signing of" } as const;

/** On a document page: each waiting request with Confirm and Decline. */
export function ClaudeRequests({ documentId, label }: { documentId: Id<"wsDocuments">; label: string }) {
  const reqs = useQuery(api.sign.requestsFor, { documentId });
  const decide = useMutation(api.sign.decideRequest);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!reqs?.length) return null;
  const go = async (id: Id<"wsRequests">, confirm: boolean) => {
    setBusy(`${id}:${confirm}`); setErr(null);
    try { await decide({ requestId: id, confirm }); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };
  return (
    <>
      {reqs.map((r) => (
        <div key={r._id} className="ws-banner ws-claudereq" role="alert">
          <Bot size={16} />
          <span className="ws-claudereq-text">
            <b>Claude asks to {VERB[r.what]} {label}</b> (version {r.versionNumber}{r.what === "send" && r.expiresInDays ? `, links for ${r.expiresInDays} days` : ""}{r.what === "cancel" && r.reason ? `, reason: "${r.reason}"` : ""}).
            <span className="secondary"> It says you told it: "{r.said}" · {central(r.createdAt)}. Nothing happens unless you confirm.</span>
          </span>
          <span className="ws-claudereq-btns">
            <button className="btn sm" disabled={!!busy} onClick={() => void go(r._id, true)}>{busy === `${r._id}:true` ? <Spinner /> : <Check size={14} />}Confirm</button>
            <button className="btn ghost sm" disabled={!!busy} onClick={() => void go(r._id, false)}>{busy === `${r._id}:false` ? <Spinner /> : <X size={14} />}Decline</button>
          </span>
        </div>
      ))}
      {err && <div className="ws-banner bad">{err}</div>}
    </>
  );
}

/** On the Contracts front page: a note for each document with a waiting request. */
export function ClaudeRequestNotices() {
  const reqs = useQuery(api.sign.pendingRequests);
  if (!reqs?.length) return null;
  return (
    <>
      {reqs.map((r) => (
        <div key={r._id} className="wp-notice" role="status">
          <Icon name="alert" size={20} /><span className="txt"><b>Claude asks to {VERB[r.what]} {r.label}</b> · {r.title}. Waiting for you to confirm.</span>
          <ButtonLink size="sm" to={`/sign/d/${r.documentId}`}>Review</ButtonLink>
        </div>
      ))}
    </>
  );
}
