// Phase 2 Part A (Oct 29): "Change order at upload" (frame 145:2090). Before a new version of a video uploads, check
// which round it would be. Within the included rounds it uploads straight away; past them, the owner chooses: cancel,
// upload as included, or draft a change order first (the upload waits in the dialog until they pick).
import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../../ui/wp";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/kit";
import { startUpload } from "../../lib/uploads";
import { errText } from "../docs/pages/common";

type Over = { videoId: Id<"videos">; file: File; next: number; included: number; project: string | null; client: string | null; video: string; then?: () => void };
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** const [uploadVersion, gate] = useRoundGate(); uploadVersion(videoId, file, afterStart) and render {gate}. */
export function useRoundGate(): [(videoId: Id<"videos">, file: File, then?: () => void) => Promise<void>, React.ReactNode] {
  const convex = useConvex();
  const [over, setOver] = useState<Over | null>(null);
  const upload = async (videoId: Id<"videos">, file: File, then?: () => void) => {
    const r: FunctionReturnType<typeof api.projects.nextRound> = await convex.query(api.projects.nextRound, { videoId }).catch(() => null);
    if (r?.over) { setOver({ videoId, file, then, ...r }); return; }
    void startUpload(convex, videoId, file);
    then?.();
  };
  const gate = over && <ChangeOrderDialog o={over} onClose={() => setOver(null)} onUpload={() => { void startUpload(convex, over.videoId, over.file); over.then?.(); setOver(null); }} />;
  return [upload, gate];
}

function ChangeOrderDialog({ o, onClose, onUpload }: { o: Over; onClose: () => void; onUpload: () => void }) {
  const convex = useConvex();
  const createBuild = useMutation(api.builder.createBuild);
  const [drafted, setDrafted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const project = o.project ?? "This project";
  const client = o.client ?? "the client";
  const incl = Array.from({ length: o.included }, (_, i) => `v${i + 1}`);
  const inclText = incl.length <= 1 ? incl.join("") : `${incl.slice(0, -1).join(", ")} and ${incl[incl.length - 1]}`;
  const draft = async () => {
    setBusy(true); setError(null);
    // Open the tab inside the click, so a popup blocker lets it through; it goes to the draft once it exists.
    const tab = window.open("about:blank", "_blank");
    try {
      const templates = await convex.query(api.builder.listTemplates, {});
      const t = templates.find((x) => /change\s*order/i.test(x.name));
      const id = await createBuild(t ? { templateId: t._id } : {});
      if (tab) tab.location.href = `/sign/b/${id}`; else window.open(`/sign/b/${id}`, "_blank");
      setDrafted(true);
    } catch (e) { tab?.close(); setError(errText(e)); }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} label="Past the included rounds" width={660}>
      <div style={{ display: "grid", gap: 18 }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">Upload · {o.video}</span>
            <h2 className="headline">v{o.next} would be round {o.next}.</h2>
            <p className="secondary" style={{ margin: 0 }}>{project} includes {o.included} {o.included === 1 ? "round" : "rounds"} per video ({inclText}). A {ordinal(o.next)} version needs a change order.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <p className="secondary" style={{ margin: 0, fontSize: "var(--fs-text-small)" }}>{drafted
          ? `The change order draft opened in a new tab. Upload now, or cancel and upload again once ${client} has signed.`
          : `Upload it as included, or draft a change order in Docs for ${client} to sign first. The upload waits either way.`}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dfoot">
          <Button variant="ghost" onClick={onClose}>Cancel upload</Button>
          {drafted ? <Button variant="primary" onClick={onUpload}>Upload now</Button> : <>
            <Button className="outline" onClick={onUpload}>Upload as included</Button>
            <Button variant="primary" onClick={draft} disabled={busy}>{busy ? "Drafting…" : "Draft a change order"}</Button>
          </>}
        </div>
      </div>
    </Modal>
  );
}
