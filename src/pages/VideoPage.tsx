import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { frameTc, fpsValue, isValidTc, nominal, type Fps } from "../../convex/lib/frames";
import { BUNNY_CDN_HOST } from "../config";
import { linkProps, navigate } from "../lib/router";
import { isVideoFile, startUpload, useUploads } from "../lib/uploads";
import { markersEdl } from "../lib/edl";
import { useFrame, useFramePlayer, type FrameClock } from "../player/useFramePlayer";
import type { FunctionReturnType } from "convex/server";
import { Timeline } from "../player/Timeline";
import { COLORS, DrawingLayer, type Shape, type Tool } from "../player/Drawing";
import { captureAndUpload } from "../player/stills";
import { NotesPanel, type NoteRow } from "../notes/NotesPanel";
import { chipText, statusText } from "./Home";

export default function VideoPage({ videoId, versionNumber }: { videoId: Id<"videos">; versionNumber: number | null }) {
  const data = useQuery(api.library.video, { videoId });
  if (data === undefined) return <main className="page"><p className="muted">Loading…</p></main>;
  if (data === null) return <main className="page"><p className="empty">This video doesn't exist any more. <a {...linkProps("/")}>Back to projects</a></p></main>;
  const versions = data.versions;
  const version = (versionNumber && versions.find((x) => x.number === versionNumber)) || versions[versions.length - 1] || null;
  return <VideoView data={data} version={version} key={version?._id ?? "none"} />;
}

type VideoData = NonNullable<FunctionReturnType<typeof api.library.video>>;
type Version = VideoData["versions"][number];

// Re-renders only its own children on every frame, not the whole page.
function AtFrame({ clock, children }: { clock: FrameClock; children: (frame: number) => React.ReactNode }) {
  const frame = useFrame(clock);
  return <>{children(frame)}</>;
}

function VideoView({ data, version }: { data: VideoData; version: Version | null }) {
  const convex = useConvex();
  const uploads = useUploads(data._id);
  const notes = useQuery(api.notes.forVersion, version ? { versionId: version._id } : "skip") as NoteRow[] | undefined;
  const createNote = useMutation(api.notes.create);
  const reportFrameCount = useMutation(api.library.reportFrameCount);
  const setStartTc = useMutation(api.library.setStartTimecode);

  const fps: Fps = useMemo(() => ({ num: version?.fpsNum ?? 24000, den: version?.fpsDen ?? 1001 }), [version?.fpsNum, version?.fpsDen]);
  const startTc = version?.startTimecode ?? "01:00:00:00";
  const tc = useCallback((f: number) => frameTc(f, startTc, fps), [startTc, fps]);

  // Source: Bunny's 1080p MP4 copy by default (full quality, exact frames), its stream as the fallback.
  const mp4H = version ? Math.max(0, ...version.mp4Heights.filter((h) => h <= 1080)) : 0;
  const [quality, setQuality] = useState<"file" | "stream">(mp4H ? "file" : "stream");
  const ready = version?.status === "ready";
  const src = !version || !ready ? null : quality === "file" && mp4H ? `https://${BUNNY_CDN_HOST}/${version.bunnyGuid}/play_${mp4H}p.mp4` : `https://${BUNNY_CDN_HOST}/${version.bunnyGuid}/playlist.m3u8`;
  const player = useFramePlayer(src, fps, version?.frameCountExact ? version.frameCount : null);
  const frameCount = player.frameCount ?? version?.frameCount ?? 0;

  // Until the backend has counted the file, save the player's estimate so lists can show a length.
  useEffect(() => {
    const est = player.estimatedFrameCount;
    if (version && !version.frameCountExact && est && est !== version.frameCount) void reportFrameCount({ versionId: version._id, frameCount: est });
  }, [player.estimatedFrameCount, version, reportFrameCount]);

  // Composer state
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [whole, setWhole] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [drawFrame, setDrawFrame] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [showDrawings, setShowDrawings] = useState(true);
  const savedDrawings = useMemo(
    () => (notes ?? [])
      .filter((n) => n.drawing && Array.isArray((n.drawing as { shapes?: unknown }).shapes) && (n.drawFrame ?? n.inFrame) !== undefined)
      .map((n) => ({ frame: (n.drawFrame ?? n.inFrame) as number, shapes: (n.drawing as { shapes: Shape[] }).shapes })),
    [notes],
  );

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const onShapes = (s: Shape[]) => {
    if (shapes.length === 0 && s.length > 0) setDrawFrame(player.clock.get());
    if (s.length === 0) setDrawFrame(null);
    setShapes(s);
  };

  async function post() {
    if (!version || posting) return;
    if (!text.trim() && shapes.length === 0) { textRef.current?.focus(); return; }
    setPosting(true);
    const v = player.videoRef.current!;
    try {
      const here = await player.settle();
      const kind = whole ? "general" : sel ? "range" : "frame";
      const inFrame = kind === "range" ? sel!.a : kind === "frame" ? (shapes.length && drawFrame !== null ? drawFrame : here) : undefined;
      const outFrame = kind === "range" ? sel!.b : undefined;
      let still: string | undefined, stillIn: string | undefined, stillOut: string | undefined;
      let stillProblem = false;
      try {
        if (shapes.length && drawFrame !== null) {
          await player.seekToFrame(drawFrame);
          still = await captureAndUpload(convex, v, shapes);
        }
        if (kind === "frame" && !still) {
          await player.seekToFrame(inFrame!);
          still = await captureAndUpload(convex, v);
        }
        if (kind === "range") {
          await player.seekToFrame(inFrame!);
          stillIn = await captureAndUpload(convex, v);
          await player.seekToFrame(outFrame!);
          stillOut = await captureAndUpload(convex, v);
          if (!still) still = stillIn;
        }
      } catch {
        stillProblem = true;
      }
      await createNote({
        versionId: version._id, kind, inFrame, outFrame,
        drawFrame: shapes.length && drawFrame !== null ? drawFrame : undefined,
        text, drawing: shapes.length ? { shapes } : undefined, still, stillIn, stillOut,
      });
      await player.seekToFrame(kind === "range" ? inFrame! : here);
      setText(""); setShapes([]); setDrawFrame(null); setDrawing(false); setSel(null); setWhole(false);
      setToast(stillProblem ? "Note added, but the still couldn't be saved." : "Note added");
    } catch (e) {
      setToast("Couldn't add the note: " + ((e as Error).message || "").replace(/^.*ConvexError: /, "").split("\n")[0]);
    } finally {
      setPosting(false);
    }
  }

  // Keyboard, like Resolve. Off while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && t === textRef.current) { e.preventDefault(); void post(); }
        if (e.key === "Escape") t.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = nominal(fps);
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") { e.preventDefault(); player.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); void player.step(e.shiftKey ? -n : -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void player.step(e.shiftKey ? n : 1); }
      else if (k === "j") { e.preventDefault(); void player.step(-n); }
      else if (k === "l") { e.preventDefault(); player.play(); }
      else if (k === "i") { e.preventDefault(); const f = player.clock.get(); setWhole(false); setSel((s) => ({ a: f, b: s && s.b >= f ? s.b : f })); }
      else if (k === "o") { e.preventDefault(); const f = player.clock.get(); setWhole(false); setSel((s) => ({ a: s && s.a <= f ? s.a : f, b: f })); }
      else if (k === "x") { e.preventDefault(); setSel(null); }
      else if (k === "d") { e.preventDefault(); player.pause(); setDrawing((d) => !d); }
      else if (e.key === "Home") { e.preventDefault(); void player.seekToFrame(0); }
      else if (e.key === "End") { e.preventDefault(); void player.seekToFrame(frameCount - 1); }
      else if (e.key === "Enter") { e.preventDefault(); player.pause(); textRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function downloadEdl() {
    if (!version || !notes) return;
    const edl = markersEdl(`${data.title} v${version.number}`, notes, startTc, fps);
    const blob = new Blob([edl], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.title.replace(/[^\w\- ]+/g, "").trim() || "markers"}_v${version.number}_markers.edl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const aspect = version?.width && version?.height ? version.width / version.height : 16 / 9;

  return (
    <main className="page">
      <div className="vhead">
        <div style={{ minWidth: 0, display: "grid", gap: 4 }}>
          <div className="crumbs">
            <a {...linkProps("/")}>Projects</a><span>/</span>
            <span>{data.project ? `${data.project.jobNumber ? data.project.jobNumber + " " : ""}${data.project.name}` : ""}</span>
          </div>
          <h1>{data.title}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {data.versions.length > 0 && (
            <select className="input" style={{ width: "auto" }} aria-label="Version" value={version?.number ?? ""} onChange={(e) => navigate(`/v/${data._id}?version=${e.target.value}`)}>
              {[...data.versions].reverse().map((x) => <option key={x._id} value={x.number}>v{x.number} · {chipText(x.status, x.encodeProgress)}</option>)}
            </select>
          )}
          <NewVersionButton onFile={(f) => void startUpload(convex, data._id, f)} />
        </div>
      </div>

      {uploads.filter((u) => u.status !== "done").map((u) => (
        <div key={u.key} className="sheet" style={{ gap: 8, maxWidth: "none" }}>
          <div className="nfoot"><b style={{ color: "var(--fg)" }}>v{u.versionNumber ?? "?"} · {u.fileName}</b> · {statusText(u.status, u.sent, u.total, u.error)}</div>
          <div className="progress"><i style={{ width: `${u.total ? (100 * u.sent) / u.total : 0}%` }} /></div>
        </div>
      ))}

      <div className="vgrid">
        <div className="col">
          <div className="stage">
            <div className="stage-inner" style={{ aspectRatio: `${aspect}`, width: `min(100%, calc(72vh * ${aspect}))` }}>
              <video ref={player.videoRef} playsInline preload="auto" onClick={() => !drawing && player.toggle()} />
              <AtFrame clock={player.clock}>{(frame) => {
                const elsewhere = shapes.length > 0 && drawFrame !== null && drawFrame !== frame;
                // Saved drawings show on their own frame (read-only), under anything being drawn now.
                const saved = showDrawings ? savedDrawings.filter((d) => d.frame === frame).flatMap((d) => d.shapes) : [];
                return (
                  <>
                    {saved.length > 0 && <DrawingLayer shapes={saved} onChange={() => {}} active={false} tool={tool} color={color} aspect={aspect} />}
                    <DrawingLayer shapes={elsewhere ? [] : shapes} onChange={onShapes} active={drawing && !elsewhere} tool={tool} color={color} aspect={aspect} />
                  </>
                );
              }}</AtFrame>
              {!version && <div className="stage-msg">No versions yet. Upload one with <b>&nbsp;New version</b>.</div>}
              {version && !ready && <div className="stage-msg">{version.status === "failed" ? `This version failed: ${version.error ?? "unknown error"}` : `v${version.number} · ${chipText(version.status, version.encodeProgress)}. It appears here when Bunny is done.`}</div>}
              {player.error && <div className="stage-msg">{player.error}</div>}
            </div>
          </div>

          {ready && (
            <>
              <Timeline
                clock={player.clock}
                frameCount={frameCount || 1}
                notes={(notes ?? []).map((n) => ({ id: n._id, kind: n.kind, inFrame: n.inFrame, outFrame: n.outFrame, status: n.status }))}
                sel={sel}
                onSeek={(f) => void player.seekToFrame(f)}
                onSelect={(a, b) => { setWhole(false); setSel({ a, b }); }}
                tickLabel={(f) => tc(f).slice(3)}
              />
              <div className="transport">
                <button className="btn small" onClick={() => void player.step(-1)} aria-label="Back one frame">◀ 1</button>
                <button className="btn small" onClick={() => player.toggle()} style={{ minWidth: 70 }}>{player.playing ? "Pause" : "Play"}</button>
                <button className="btn small" onClick={() => void player.step(1)} aria-label="Forward one frame">1 ▶</button>
                <button className={`btn small${showDrawings ? " on" : ""}`} onClick={() => setShowDrawings(!showDrawings)} title="Show the drawings saved with notes on their frames">Note drawings</button>
                <select className="input" style={{ width: "auto", padding: "5px 8px" }} aria-label="Quality" value={quality} onChange={(e) => setQuality(e.target.value as "file" | "stream")}>
                  {mp4H > 0 && <option value="file">{mp4H}p file</option>}
                  <option value="stream">Stream (auto)</option>
                </select>
                <AtFrame clock={player.clock}>{(frame) => (
                  <div className="readout">
                    <span className="tc">{tc(frame)}</span>
                    <span className="fr">fr {frame}{frameCount ? ` / ${frameCount - 1}` : ""} · {fpsValue(fps).toFixed(3)}</span>
                  </div>
                )}</AtFrame>
              </div>

              <div className="composer">
                <div className="target">
                  <span className="label">Note on</span>
                  <span className="what">
                    {whole ? "Whole video" : sel ? `${tc(sel.a)} → ${tc(sel.b)} · ${sel.b - sel.a + 1} frames` : <AtFrame clock={player.clock}>{(frame) => tc(shapes.length && drawFrame !== null ? drawFrame : frame)}</AtFrame>}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn small" title="Set range start (I)" onClick={() => { const f = player.clock.get(); setWhole(false); setSel((s) => ({ a: f, b: s && s.b >= f ? s.b : f })); }}>In</button>
                    <button className="btn small" title="Set range end (O)" onClick={() => { const f = player.clock.get(); setWhole(false); setSel((s) => ({ a: s && s.a <= f ? s.a : f, b: f })); }}>Out</button>
                    {sel && <button className="btn small" title="Clear range (X)" onClick={() => setSel(null)}>Clear range</button>}
                    <button className={`btn small${whole ? " on" : ""}`} onClick={() => { setWhole(!whole); setSel(null); }}>Whole video</button>
                  </span>
                </div>
                <div className="tools">
                  <button className={`btn small${drawing ? " on" : ""}`} onClick={() => { player.pause(); setDrawing(!drawing); }} title="Draw (D)">{drawing ? "Drawing" : "Draw"}</button>
                  {drawing && (
                    <>
                      {(["pen", "arrow", "box", "ellipse"] as Tool[]).map((t) => (
                        <button key={t} className={`btn small${tool === t ? " on" : ""}`} onClick={() => setTool(t)}>{t === "pen" ? "Pen" : t === "arrow" ? "Arrow" : t === "box" ? "Box" : "Circle"}</button>
                      ))}
                      {COLORS.map((c) => <button key={c} className={`swatch${color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />)}
                      <button className="btn small" disabled={!shapes.length} onClick={() => onShapes(shapes.slice(0, -1))}>Undo</button>
                      <button className="btn small" disabled={!shapes.length} onClick={() => onShapes([])}>Clear</button>
                    </>
                  )}
                  <AtFrame clock={player.clock}>{(frame) => shapes.length > 0 && drawFrame !== null && drawFrame !== frame && (
                    <button className="btn small" onClick={() => void player.seekToFrame(drawFrame)}>Drawing is on {tc(drawFrame)} · go back</button>
                  )}</AtFrame>
                </div>
                <textarea ref={textRef} className="input" id="noteText" value={text} onChange={(e) => setText(e.target.value)} onFocus={() => player.pause()} placeholder="Write a note. ⌘↵ adds it." />
                <div className="composer-foot">
                  <span className="faint" style={{ fontSize: 12 }}>Space play · ← → frame · ⇧← → second · I / O range · D draw · Enter write</span>
                  <button className="btn solid" onClick={() => void post()} disabled={posting || (!text.trim() && !shapes.length)}>{posting ? "Adding…" : "Add note"}</button>
                </div>
              </div>

              <VersionSettings versionId={version!._id} startTc={startTc} onSave={async (v) => { await setStartTc({ versionId: version!._id, startTimecode: v }); setToast("Start timecode saved"); }} />
            </>
          )}
        </div>

        <NotesPanel
          notes={version ? notes : []}
          clock={player.clock}
          tc={tc}
          onJump={(n) => { if (n.inFrame !== undefined) void player.seekToFrame(n.inFrame); if (n.kind === "range") setSel({ a: n.inFrame!, b: n.outFrame! }); }}
          onDownloadEdl={downloadEdl}
        />
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function NewVersionButton({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn" onClick={() => ref.current?.click()}>New version</button>
      <input ref={ref} type="file" hidden accept="video/*,.mov,.mp4,.m4v,.mxf,.mkv" onChange={(e) => { const f = e.target.files?.[0]; if (f && isVideoFile(f)) onFile(f); e.target.value = ""; }} />
    </>
  );
}

function VersionSettings({ startTc, onSave }: { versionId: string; startTc: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(startTc);
  const changed = v !== startTc;
  return (
    <div className="vsettings">
      <label htmlFor="startTc" className="label">Starts at</label>
      <input id="startTc" className="input mono" value={v} onChange={(e) => setV(e.target.value)} />
      {changed && <button className="btn small" disabled={!isValidTc(v)} onClick={() => void onSave(v.trim())}>Save</button>}
      <span className="faint" style={{ fontSize: 12 }}>The timecode of this render's first frame. 01:00:00:00 when you render the whole timeline.</span>
    </div>
  );
}
