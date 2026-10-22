// Video list rows and grid cards, shared by Home, Projects and the register.
// R2b: the details beside each video follow "Show details" (account setting); Final shows as a badge.
import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { CircleCheckBig } from "lucide-react";
import { linkProps } from "../lib/router";
import { Spinner, Thumb } from "../ui/kit";
import { ago, transcriptChip } from "../lib/format";
import { DEFAULT_FIELDS, fieldText, pad5, statusText, type FieldKey } from "../lib/details";

export type Overview = FunctionReturnType<typeof api.library.overview>;
export type VideoItem = Overview["videos"][number];
type Project = Overview["projects"][number];

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function FinalBadge({ final }: { final: { version: number; at: number } | null }) {
  if (!final) return null;
  return <span className="chip final" title={`Approved ${new Date(final.at).toLocaleString()}`}><CircleCheckBig size={12} />Final · v{final.version} · {day(final.at)}</span>;
}

function Detail({ k, x, p }: { k: FieldKey; x: VideoItem; p: Project | undefined }) {
  const t = fieldText(k, x, p);
  if (!t) return null;
  if (k === "latest") return <span className="chip">{t}</span>;
  if (k === "length") return <span className="chip dur">{t}</span>;
  if (k === "status") { const s = statusText(x); return s.tone === "final" ? null : <span className={`chip ${s.tone}`}>{t}</span>; }
  if (k === "notes") return <span className={`dt open${x.openNotes ? " has" : ""}`}>{t}</span>;
  return <span className={`dt dt-${k}`}>{t}</span>;
}

type RowProps = {
  x: VideoItem; meta?: React.ReactNode; projectName?: string; project?: Project;
  fields?: FieldKey[]; onApprove?: (x: VideoItem) => void;
};

export function VideoRow({ x, meta, projectName, project, fields = DEFAULT_FIELDS, onApprove }: RowProps) {
  const st = statusText(x);
  const busy = x.latest && x.latest.status !== "ready";
  const tr = x.latest?.status === "ready" ? transcriptChip(x.latest.transcript) : null;
  const rest = fields.filter((k) => k !== "number");
  const canApprove = onApprove && x.latest && x.versionCount > 0;
  return (
    <div className="vline">
      <a className="vrow" {...linkProps(`/v/${x._id}`)}>
        <Thumb src={x.latest?.thumbUrl ?? null} />
        <span className="t">
          {fields.includes("number") && x.number ? <span className="chip num mono" title="Register number">{pad5(x.number)}</span> : null}
          <b>{x.title}</b>
          <FinalBadge final={x.final} />
          {!fields.includes("status") && (busy || st.tone === "fail") && <span className={`chip ${st.tone}`}>{busy && <Spinner />}{st.text}</span>}
          {!x.latest && !fields.includes("status") && <span className="chip">No versions</span>}
          {tr?.busy && <span className="chip warn"><Spinner />{tr.text}</span>}
          {projectName && <span className="secondary hide-sm pname">{projectName}</span>}
        </span>
        <span className="details">{rest.map((k) => <Detail key={k} k={k} x={x} p={project} />)}</span>
        {meta && <span className="meta">{meta}</span>}
      </a>
      {canApprove && <button className={`btn sm approve${x.final ? " done" : ""}`} onClick={() => onApprove!(x)} title="Keep one version and delete the others">{x.final ? `Final v${x.final.version}` : "Approve final"}</button>}
    </div>
  );
}

export function VideoCard({ x, meta, projectName, project, fields = DEFAULT_FIELDS, onApprove }: RowProps) {
  const st = statusText(x);
  const busy = x.latest && x.latest.status !== "ready";
  const rest = fields.filter((k) => k !== "number" && k !== "latest");
  return (
    <div className="cardwrap">
      <a className="card rect" {...linkProps(`/v/${x._id}`)}>
        <div className="media">
          <Thumb src={x.latest?.thumbUrl ?? null} className="" />
        </div>
        <div className="cbody">
          <span className="rlabel">{fields.includes("number") && x.number ? `${pad5(x.number)} · ` : ""}{projectName ? `${projectName} · ` : ""}{x.latest ? `v${x.latest.number}` : "No versions"}</span>
          <div className="rbold ctitle">{x.title}</div>
          <div className="rtags">
            {x.final && <span className="rtag final">Final · v{x.final.version}</span>}
            {!fields.includes("status") && busy && <span className="rtag"><Spinner />{st.text}</span>}
            {rest.map((k) => {
              const t = fieldText(k, x, project);
              if (!t || (k === "status" && st.tone === "final")) return null;
              return <span key={k} className="rtag">{t}</span>;
            })}
          </div>
          {meta && <div className="cm">{meta}</div>}
        </div>
      </a>
      {onApprove && x.latest && <button className={`btn sm approve${x.final ? " done" : ""}`} onClick={() => onApprove(x)}>{x.final ? `Final v${x.final.version}` : "Approve final"}</button>}
    </div>
  );
}

export const updatedMeta = (x: VideoItem) => <>Updated <em>{ago(x.updatedAt)}</em></>;
export const openedMeta = (x: VideoItem) => x.lastOpenedAt ? <>Opened <em>{ago(x.lastOpenedAt)}</em></> : <>Not opened yet</>;
