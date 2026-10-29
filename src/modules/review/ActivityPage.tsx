// Activity: uploads, new versions and notes, newest first. Notes from one sitting sit in one row of cards.
import { useState } from "react";
import { BrandImg } from "../../ui/BrandImg";
import { useQuery } from "convex/react";
import { ArrowUpRight, Link2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Sep, TopBar } from "../../shell/Shell";
import { Icon } from "../../ui/Icon";
import { linkProps } from "../../lib/router";
import { Avatar, Menu, MenuItem, MenuLabel, Thumb } from "../../ui/kit";
import { ago, lengthText } from "../../lib/format";
import { frameTc } from "../../../convex/lib/frames";

export default function ActivityPage() {
  const feed = useQuery(api.activity.feed, { limit: 100 });
  const [show, setShow] = useState({ videos: true, versions: true, notes: true, shares: true });
  const [who, setWho] = useState<string | null>(null);
  const people = [...new Set((feed ?? []).map((e) => e.actor).filter(Boolean) as string[])];
  const rows = (feed ?? []).filter((e) =>
    (e.type === "share" ? show.shares : e.type === "notes" ? show.notes : e.type === "approval" ? true : e.version.number === 1 ? show.videos : show.versions) && (!who || e.actor === who));

  return (
    <>
      <TopBar right={
        <Menu align="end" label="Show" trigger={(p) => <button {...p} className="icon-btn" aria-label="Filter activity" title="Filter"><Icon name="menu" size={18} /></button>}>
          <MenuLabel>Show</MenuLabel>
          <MenuItem keepOpen checked={show.videos} onSelect={() => setShow({ ...show, videos: !show.videos })}>New videos</MenuItem>
          <MenuItem keepOpen checked={show.versions} onSelect={() => setShow({ ...show, versions: !show.versions })}>New versions</MenuItem>
          <MenuItem keepOpen checked={show.notes} onSelect={() => setShow({ ...show, notes: !show.notes })}>Notes</MenuItem>
          <MenuItem keepOpen checked={show.shares} onSelect={() => setShow({ ...show, shares: !show.shares })}>Shared links opened</MenuItem>
        </Menu>
      }>
        <a {...linkProps("/review")}>Review</a><Sep /><span className="here">Activity</span>
      </TopBar>
      <div className="content">
        <div className="toolbar">
          <div className="tabs" role="tablist">
            <button role="tab" className="tab" aria-selected={!who} onClick={() => setWho(null)}>All activity</button>
            {people.map((p) => <button key={p} role="tab" className="tab" aria-selected={who === p} onClick={() => setWho(p)}><Avatar name={p} />{p}</button>)}
          </div>
        </div>
        {feed === undefined ? <p className="caption" style={{ padding: "8px 24px" }}>Loading…</p>
          : rows.length === 0 ? <div className="empty"><BrandImg name="spark" /><span>Nothing here yet.</span></div>
          : (
            <div className="feed wp-card glass">
              {rows.map((e, i) => {
                if (e.type === "share") {
                  return (
                    <div className="event" key={i}>
                      <div className="when">{ago(e.at)}</div>
                      <div>
                        <div className="ehead">
                          <Avatar name={e.actor} />
                          <b>{e.actor}</b>
                          {e.kind === "opened" ? <>opened the shared link for</> : <>watched</>}
                          {e.kind === "viewed" && e.videoId ? <a className="v" {...linkProps(`/v/${e.videoId}`)}>{e.videoTitle ?? "a video"}</a> : null}
                          {e.kind === "viewed" && <span className="secondary">through the link for</span>}
                          <a className="v" {...linkProps("/settings/shares")}><Link2 size={14} /> {e.share.label}</a>
                          <span className="secondary">· shared {e.share.shareKind}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                if (e.type === "approval") {
                  const v = e.version;
                  return (
                    <div className="event" key={i}>
                      <div className="when">{ago(e.at)}</div>
                      <div>
                        <div className="ehead">
                          <Avatar name={e.actor} />
                          <b>{e.actor}</b>approved<span className="chip">v{v.number}</span>of
                          <a className="v" {...linkProps(`/v/${v.videoId}?version=${v.number}`)}><Thumb src={v.thumbUrl} /> {v.videoTitle}</a>
                          {v.projectName && <span className="secondary">· {v.projectName}</span>}
                        </div>
                      </div>
                    </div>
                  );
                }
                const ver = e.version;
                const fps = { num: ver.fpsNum, den: ver.fpsDen };
                const href = `/v/${ver.videoId}?version=${ver.number}`;
                return (
                  <div className="event" key={i}>
                    <div className="when">{ago(e.at)}</div>
                    <div>
                      <div className="ehead">
                        <Avatar name={e.actor ?? "?"} />
                        <b>{e.actor ?? "Someone"}</b>
                        {e.type === "notes" ? <>left {e.notes.length} note{e.notes.length === 1 ? "" : "s"} on</> : ver.number > 1 ? <>added <span className="chip">v{ver.number}</span> of</> : <>added</>}
                        <a className="v" {...linkProps(href)}><Thumb src={ver.thumbUrl} /> {ver.videoTitle}</a>
                        {e.type === "notes" && <span className="chip">v{ver.number}</span>}
                        {ver.projectName && <span className="secondary">· {ver.projectName}</span>}
                      </div>
                      <div className="ebody">
                        {e.type === "notes" ? (
                          <div className="ncards">
                            {e.notes.map((n) => (
                              <a key={n._id} className={`ncard rect${n.status === "done" ? " done" : ""}`} {...linkProps(`${href}&note=${n._id}`)}>
                                <div className="rrow">
                                  <span className="rlabel">
                                    <span className="dot" style={{ background: n.kind === "frame" ? "var(--mk-frame)" : n.kind === "range" ? "var(--mk-range)" : "var(--mk-video)" }} />
                                    {n.kind === "frame" ? "Frame" : n.kind === "range" ? "Range" : "Note"}
                                  </span>
                                  <span className="right"><ArrowUpRight size={14} /></span>
                                </div>
                                <div className="rbold">
                                  {n.kind === "general" ? "Whole video" : frameTc(n.inFrame!, ver.startTimecode, fps)}
                                  {n.kind === "range" && n.outFrame !== null && <span className="out">→ {frameTc(n.outFrame, ver.startTimecode, fps)}</span>}
                                </div>
                                {(n.hasDrawing || n.status === "done") && (
                                  <div className="rtags">
                                    {n.hasDrawing && <span className="rtag">Drawing</span>}
                                    {n.status === "done" && <span className="rtag">Done</span>}
                                  </div>
                                )}
                                {n.text ? <div className="nt">{n.text}</div> : <div className="nt secondary">Drawing only</div>}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <a className="card rect" {...linkProps(href)}>
                            <div className="media"><Thumb src={ver.thumbUrl} className="" /></div>
                            <div className="cbody">
                              <span className="rlabel">{ver.number > 1 ? `New version · v${ver.number}` : "New video"}</span>
                              <div className="rbold ctitle">{ver.videoTitle}</div>
                              <div className="rtags">
                                {lengthText(ver.frameCount, fps) && <span className="rtag">{lengthText(ver.frameCount, fps)}</span>}
                                {ver.projectName && <span className="rtag">{ver.projectName}</span>}
                              </div>
                            </div>
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </>
  );
}
