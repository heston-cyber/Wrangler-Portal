// Video list rows and grid cards, shared by Home and Projects.
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { linkProps } from "../lib/router";
import { Spinner, Thumb } from "../ui/kit";
import { ago, lengthText, statusChip, transcriptChip } from "../lib/format";

export type Overview = FunctionReturnType<typeof api.library.overview>;
export type VideoItem = Overview["videos"][number];

const fpsOf = (x: VideoItem) => ({ num: x.latest?.fpsNum ?? 24000, den: x.latest?.fpsDen ?? 1001 });

export function VideoRow({ x, meta, projectName }: { x: VideoItem; meta: React.ReactNode; projectName?: string }) {
  const st = x.latest ? statusChip(x.latest.status, x.latest.encodeProgress) : { text: "No versions", tone: "" as const };
  const tr = x.latest?.status === "ready" ? transcriptChip(x.latest.transcript) : null;
  const len = x.latest ? lengthText(x.latest.frameCount, fpsOf(x)) : null;
  return (
    <a className="vrow" {...linkProps(`/v/${x._id}`)}>
      <Thumb guid={x.latest?.bunnyGuid} />
      <span className="t">
        {x.number ? <span className="chip num mono" title="Register number">{String(x.number).padStart(5, "0")}</span> : null}
        <b>{x.title}</b>
        {x.latest && x.latest.number > 1 && <span className="chip">v{x.latest.number}</span>}
        {st && <span className={`chip ${st.tone}`}>{st.busy && <Spinner />}{st.text}</span>}
        {tr && <span className={`chip${tr.busy ? " warn" : ""}`}>{tr.busy && <Spinner />}{tr.text}</span>}
        {projectName && <span className="secondary hide-sm" style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{projectName}</span>}
      </span>
      <span className={`open${x.openNotes ? " has" : ""}`}>{x.openNotes ? `${x.openNotes} open` : ""}</span>
      <span className="dur">{len && <span className="chip dur">{len}</span>}</span>
      <span className="meta">{meta}</span>
    </a>
  );
}

export function VideoCard({ x, meta, projectName }: { x: VideoItem; meta: React.ReactNode; projectName?: string }) {
  const st = x.latest ? statusChip(x.latest.status, x.latest.encodeProgress) : { text: "No versions", tone: "" as const };
  const tr = x.latest?.status === "ready" ? transcriptChip(x.latest.transcript) : null;
  const len = x.latest ? lengthText(x.latest.frameCount, fpsOf(x)) : null;
  return (
    <a className="card rect" {...linkProps(`/v/${x._id}`)}>
      <div className="media">
        <Thumb guid={x.latest?.bunnyGuid} className="" />
      </div>
      <div className="cbody">
        <span className="rlabel">{x.number ? `${String(x.number).padStart(5, "0")} · ` : ""}{projectName ? `${projectName} · ` : ""}{x.latest ? `v${x.latest.number}` : "No versions"}</span>
        <div className="rbold ctitle">{x.title}</div>
        <div className="rtags">
          {len && <span className="rtag">{len}</span>}
          {st && <span className="rtag">{st.busy && <Spinner />}{st.text}</span>}
          {tr && <span className="rtag">{tr.busy && <Spinner />}{tr.text}</span>}
          {x.openNotes > 0 && <span className="rtag">{x.openNotes} open</span>}
        </div>
        <div className="cm">{meta}</div>
      </div>
    </a>
  );
}

export const updatedMeta = (x: VideoItem) => <>Updated <em>{ago(x.updatedAt)}</em></>;
export const openedMeta = (x: VideoItem) => x.lastOpenedAt ? <>Opened <em>{ago(x.lastOpenedAt)}</em></> : <>Not opened yet</>;
