// The review page, laid out like Flask: breadcrumb bar, the picture with a floating note box,
// a Notes / Versions panel on the right, and the transport along the bottom.
// Frame-exact: every note is stored as integer frames from frame 0 of its version.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  ArrowUp, Brush, Check, Circle, Download, Ellipsis, Eye, Keyboard, Maximize, MoveUpRight, PanelRight, Pause, Pencil, Play,
  Plus, SlidersHorizontal, Square, Timer, Undo2, Upload, Volume2, VolumeX, X,
} from "lucide-react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { frameTc, frameDuration, isValidTc, nominal, type Fps } from "../../convex/lib/frames";
import { BUNNY_CDN_HOST } from "../config";
import { linkProps, navigate } from "../lib/router";
import { isVideoFile, startUpload, useUploads } from "../lib/uploads";
import { markersEdl } from "../lib/edl";
import { clockText, projectLabel, statusChip } from "../lib/format";
import { useFrame, useFramePlayer, type FrameClock } from "../player/useFramePlayer";
import { Scrubber } from "../player/Scrubber";
import { COLORS, DrawingLayer, type Shape, type Tool } from "../player/Drawing";
import { captureAndUpload } from "../player/stills";
import { NotesList, defaultFilter, kindColor, type NoteFilter, type NoteRow } from "../notes/NotesPanel";
import { VersionsList } from "../notes/VersionsPanel";
import { Sep, TopBar } from "../shell/Shell";
import { Menu, MenuItem, MenuLabel, MenuSep, Modal, useIsNarrow, useToast } from "../ui/kit";

export default function VideoPage({ videoId, versionNumber, noteId }: { videoId: Id<"videos">; versionNumber: number | null; noteId: string | null }) {
  const data = useQuery(api.library.video, { videoId });
  const markOpened = useMutation(api.library.markOpened);
  useEffect(() => { void markOpened({ videoId }).catch(() => {}); }, [videoId, markOpened]);
  if (data === undefined) return <><TopBar><span className="secondary">Loading…</span></TopBar><div className="content" /></>;
  if (data === null) {
    return (
      <>
        <TopBar><a {...linkProps("/")}>Home</a></TopBar>
        <div className="content"><div className="empty">This video doesn't exist any more. <a className="btn" {...linkProps("/projects")}>All projects</a></div></div>
      </>
    );
  }
  const versions = data.versions;
  const version = (versionNumber && versions.find((x) => x.number === versionNumber)) || versions[versions.length - 1] || null;
  return <ReviewView data={data} version={version} noteId={noteId} key={version?._id ?? "none"} />;
}

type VideoData = NonNullable<FunctionReturnType<typeof api.library.video>>;
type Version = VideoData["versions"][number];
type TimeMode = "tc" | "frames" | "clock";

// Re-renders only its own children on every frame, not the whole page.
function AtFrame({ clock, children }: { clock: FrameClock; children: (frame: number) => React.ReactNode }) {
  const frame = useFrame(clock);
  return <>{children(frame)}</>;
}

// Largest box of the picture's shape that fits the space (on phones: the width, capped at 60% of the screen height).
function useFit(aspect: number, narrow: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth;
      const H = narrow ? Math.round(window.innerHeight * 0.6) : el.clientHeight;
      let w = W, h = W / aspect;
      if (h > H) { h = H; w = H * aspect; }
      setBox({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, narrow]);
  return [ref, box] as const;
}

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback; } catch { return fallback; }
}
function writePref(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

function ReviewView({ data, version, noteId }: { data: VideoData; version: Version | null; noteId: string | null }) {
  const convex = useConvex();
  const narrow = useIsNarrow();
  const uploads = useUploads(data._id);
  const notes = useQuery(api.notes.forVersion, version ? { versionId: version._id } : "skip") as NoteRow[] | undefined;
  const createNote = useMutation(api.notes.create);
  const reportFrameCount = useMutation(api.library.reportFrameCount);
  const [toast, showToast] = useToast();

  const fps: Fps = useMemo(() => ({ num: version?.fpsNum ?? 24000, den: version?.fpsDen ?? 1001 }), [version?.fpsNum, version?.fpsDen]);
  const startTc = version?.startTimecode ?? "01:00:00:00";
  const tc = useCallback((f: number) => frameTc(f, startTc, fps), [startTc, fps]);

  // Source: Bunny's 1080p MP4 copy by default (full quality, exact frames); its stream as the fallback.
  const mp4H = version ? Math.max(0, ...version.mp4Heights.filter((h) => h <= 1080)) : 0;
  const [quality, setQuality] = useState<"file" | "stream">(mp4H ? "file" : "stream");
  const ready = version?.status === "ready";
  const src = !version || !ready ? null : quality === "file" && mp4H ? `https://${BUNNY_CDN_HOST}/${version.bunnyGuid}/play_${mp4H}p.mp4` : `https://${BUNNY_CDN_HOST}/${version.bunnyGuid}/playlist.m3u8`;
  const player = useFramePlayer(src, fps, version?.frameCountExact ? version.frameCount : null);
  const frameCount = player.frameCount ?? version?.frameCount ?? 0;

  useEffect(() => {
    const est = player.estimatedFrameCount;
    if (version && !version.frameCountExact && est && est !== version.frameCount) void reportFrameCount({ versionId: version._id, frameCount: est });
  }, [player.estimatedFrameCount, version, reportFrameCount]);

  // Panel, transport and view state
  const [panel, setPanel] = useState<"notes" | "versions" | null>(() => (window.innerWidth <= 820 ? "notes" : readPref<string>("wr.panel", "notes") === "none" ? null : "notes"));
  const [filter, setFilter] = useState<NoteFilter>(defaultFilter);
  const [timeMode, setTimeMode] = useState<TimeMode>(() => readPref<TimeMode>("wr.timeMode", "tc"));
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showDrawings, setShowDrawings] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(noteId);
  const [dialog, setDialog] = useState<null | "rename" | "starttc" | "keys">(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Composer state
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [hl, setHl] = useState<{ a: number; b: number } | null>(null); // the range of the note you jumped to
  const [whole, setWhole] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [drawFrame, setDrawFrame] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const savedDrawings = useMemo(
    () => (notes ?? [])
      .filter((n) => n.drawing && Array.isArray((n.drawing as { shapes?: unknown }).shapes) && (n.drawFrame ?? n.inFrame) !== undefined)
      .map((n) => ({ frame: (n.drawFrame ?? n.inFrame) as number, shapes: (n.drawing as { shapes: Shape[] }).shapes })),
    [notes],
  );
  const aspect = version?.width && version?.height ? version.width / version.height : 16 / 9;
  const [wrapRef, box] = useFit(aspect, narrow);

  useEffect(() => { const v = player.videoRef.current; if (v) v.playbackRate = rate; }, [rate, player.videoRef, src]);
  useEffect(() => { const v = player.videoRef.current; if (v) v.muted = muted; }, [muted, player.videoRef, src]);

  // Grow the note box with its text.
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(160, Math.max(34, t.scrollHeight)) + "px";
  }, [text]);

  const jump = useCallback((n: NoteRow) => {
    setFocusId(n._id);
    if (n.inFrame !== undefined) void player.seekToFrame(n.inFrame);
    setHl(n.kind === "range" ? { a: n.inFrame!, b: n.outFrame! } : null);
  }, [player]);

  // Opened from a link to one note (?note=…): jump to it once the video is ready.
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !noteId || !notes || !player.ready) return;
    const n = notes.find((x) => x._id === noteId);
    if (n) { jumped.current = true; setPanel("notes"); jump(n); }
  }, [noteId, notes, player.ready, jump]);

  const onShapes = (s: Shape[]) => {
    if (shapes.length === 0 && s.length > 0) setDrawFrame(player.clock.get());
    if (s.length === 0) setDrawFrame(null);
    setShapes(s);
  };
  const setIn = () => { const f = player.clock.get(); setWhole(false); setSel((s) => ({ a: f, b: s && s.b >= f ? s.b : f })); };
  const setOut = () => { const f = player.clock.get(); setWhole(false); setSel((s) => ({ a: s && s.a <= f ? s.a : f, b: f })); };

  async function post() {
    if (!version || posting || !ready) return;
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
      const id = await createNote({
        versionId: version._id, kind, inFrame, outFrame,
        drawFrame: shapes.length && drawFrame !== null ? drawFrame : undefined,
        text, drawing: shapes.length ? { shapes } : undefined, still, stillIn, stillOut,
      });
      await player.seekToFrame(kind === "range" ? inFrame! : here);
      setText(""); setShapes([]); setDrawFrame(null); setDrawing(false); setSel(null); setWhole(false);
      setFocusId(id); setPanel((p) => p ?? "notes");
      showToast(stillProblem ? "Note added, but the still couldn't be saved." : "Note added");
    } catch (e) {
      showToast("Couldn't add the note: " + ((e as Error).message || "").replace(/^.*ConvexError: /, "").split("\n")[0]);
    } finally {
      setPosting(false);
    }
  }

  // Keyboard, like Resolve. Off while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (document.querySelector(".backdrop, .menu")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = nominal(fps);
      const k = e.key.toLowerCase();
      if (k === " " || k === "k") { e.preventDefault(); player.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); void player.step(e.shiftKey ? -n : -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); void player.step(e.shiftKey ? n : 1); }
      else if (k === "j") { e.preventDefault(); void player.step(-n); }
      else if (k === "l") { e.preventDefault(); player.play(); }
      else if (k === "i") { e.preventDefault(); setIn(); }
      else if (k === "o") { e.preventDefault(); setOut(); }
      else if (k === "x") { e.preventDefault(); setSel(null); }
      else if (k === "d") { e.preventDefault(); player.pause(); setDrawing((d) => !d); }
      else if (k === "f") { e.preventDefault(); toggleFullscreen(); }
      else if (e.key === "?") { e.preventDefault(); setDialog("keys"); }
      else if (e.key === "Escape") { if (drawing) setDrawing(false); else if (sel) setSel(null); else setHl(null); }
      else if (e.key === "Home") { e.preventDefault(); void player.seekToFrame(0); }
      else if (e.key === "End") { e.preventDefault(); void player.seekToFrame(frameCount - 1); }
      else if (e.key === "Enter") { e.preventDefault(); player.pause(); textRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => {});
  }

  function downloadEdl() {
    if (!version || !notes) return;
    const edl = markersEdl(`${data.title} v${version.number}`, notes, startTc, fps);
    const blob = new Blob([edl], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.title.replace(/[^\w\- ]+/g, "").trim() || "markers"}_v${version.number}_markers.edl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast("Markers downloaded. In Resolve: Timeline › Import › Timeline Markers from EDL");
  }

  const newVersion = () => fileRef.current?.click();
  const setPanelPref = (p: "notes" | "versions" | null) => { setPanel(p); writePref("wr.panel", p ? "notes" : "none"); };
  const endFrame = Math.max(0, frameCount - 1);
  const timeText = (f: number) => timeMode === "frames" ? `${f}` : timeMode === "clock" ? clockText(f * frameDuration(fps)) : tc(f);
  const openCount = (notes ?? []).filter((n) => n.status === "open").length;
  const st = version ? statusChip(version.status, version.encodeProgress) : null;

  // The play bar: along the bottom on desktop (like Flask); right under the picture on phones.
  const transportBar = (
        <div className="transport">
          <button className="play" onClick={() => player.toggle()} disabled={!ready} aria-label={player.playing ? "Pause (Space)" : "Play (Space)"}>{player.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
          <button className="timebtn" onClick={() => { const m: TimeMode = timeMode === "tc" ? "frames" : timeMode === "frames" ? "clock" : "tc"; setTimeMode(m); writePref("wr.timeMode", m); }}
            title="Switch between timecode, frames and minutes">
            <AtFrame clock={player.clock}>{(f) => <>{timeMode === "frames" && <span className="of">fr</span>}{timeText(f)}<span className="of">/ {timeText(endFrame)}</span></>}</AtFrame>
          </button>
          {ready ? <Scrubber
            clock={player.clock}
            frameCount={frameCount || 1}
            notes={(notes ?? []).map((n) => ({ id: n._id, kind: n.kind, inFrame: n.inFrame, outFrame: n.outFrame, status: n.status }))}
            sel={sel}
            highlight={hl}
            onSeek={(f) => void player.seekToFrame(f)}
            onSelect={(a, b) => { setWhole(false); setSel({ a, b }); }}
            label={(f) => tc(f)}
          /> : <div style={{ flex: 1 }} />}
          <Menu side="top" align="end" label="Playback speed" trigger={(p) => <button {...p} className="speedbtn" title="Playback speed">{rate}×</button>}>
            <MenuLabel>Speed</MenuLabel>
            {SPEEDS.map((s) => <MenuItem key={s} checked={rate === s} onSelect={() => setRate(s)}>{s}×</MenuItem>)}
          </Menu>
          <button className="icon-btn hide-sm" onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute" : "Mute"}>{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
          <Menu side="top" align="end" label="View options" trigger={(p) => <button {...p} className="icon-btn" aria-label="View options" title="View options"><Eye size={16} /></button>}>
            <MenuLabel>Picture</MenuLabel>
            {mp4H > 0 && <MenuItem checked={quality === "file"} onSelect={() => setQuality("file")}>{mp4H}p file (exact frames)</MenuItem>}
            <MenuItem checked={quality === "stream"} onSelect={() => setQuality("stream")}>Stream (adapts to connection)</MenuItem>
            <MenuSep />
            <MenuItem checked={showDrawings} onSelect={() => setShowDrawings(!showDrawings)}>Show note drawings</MenuItem>
            <MenuItem icon={<Maximize size={16} />} kbd="F" onSelect={toggleFullscreen}>Full screen</MenuItem>
            <MenuItem icon={<Keyboard size={16} />} kbd="?" onSelect={() => setDialog("keys")}>Keyboard shortcuts</MenuItem>
          </Menu>
        </div>
  );

  return (
    <div className="review" ref={rootRef}>
      <TopBar right={
        <>
          <button className="btn sm hide-sm" onClick={downloadEdl} disabled={!notes?.length} title="Download the notes as Resolve markers (EDL)"><Download size={15} />Resolve markers</button>
          <button className={`icon-btn md${panel ? " on" : ""}`} onClick={() => setPanelPref(panel ? null : "notes")} aria-label={panel ? "Hide panel" : "Show panel"} title={panel ? "Hide panel" : "Show panel"}><PanelRight size={16} /></button>
        </>
      }>
        <a {...linkProps("/")} aria-label="Home" style={{ display: "flex" }}><img className="logo" src="/brand/wordmark-cream.png" alt="Wrangler Productions" /></a>
        <Sep />
        {data.project && <span className="hide-sm" style={{ display: "contents" }}><a {...linkProps(`/projects/${data.project._id}`)}>{projectLabel(data.project)}</a><Sep /></span>}
        <span className="here">{data.title}</span>
        {version && <button className="chip" onClick={() => setPanel("versions")} title="Versions">v{version.number}{data.versions.length > 1 ? ` of ${data.versions.length}` : ""}</button>}
        {st && <span className={`chip ${st.tone}`}>{st.text}</span>}
        <Menu label="Video options" trigger={(p) => <button {...p} className="icon-btn" aria-label="Video options"><Ellipsis size={16} /></button>}>
          <MenuItem icon={<Upload size={16} />} onSelect={newVersion}>Upload a new version</MenuItem>
          <MenuItem icon={<Pencil size={16} />} onSelect={() => setDialog("rename")}>Rename video</MenuItem>
          <MenuItem icon={<Timer size={16} />} onSelect={() => setDialog("starttc")} disabled={!version}>Start timecode…</MenuItem>
          <MenuSep />
          <MenuItem icon={<Download size={16} />} onSelect={downloadEdl} disabled={!notes?.length}>Download Resolve markers</MenuItem>
          <MenuItem icon={<Keyboard size={16} />} onSelect={() => setDialog("keys")} kbd="?">Keyboard shortcuts</MenuItem>
        </Menu>
      </TopBar>
      <input ref={fileRef} type="file" hidden accept="video/*,.mov,.mp4,.m4v,.mxf,.mkv"
        onChange={(e) => { const f = e.target.files?.[0]; if (f && isVideoFile(f)) { void startUpload(convex, data._id, f); setPanel("versions"); showToast("Uploading a new version…"); } e.target.value = ""; }} />

      <div className="rbody">
        <div className="stagecol">
          <div className="stagewrap" ref={wrapRef} style={narrow ? { height: box.h || undefined } : undefined}>
            <div className="stage" style={{ width: box.w || undefined, height: box.h || undefined, aspectRatio: box.w ? undefined : `${aspect}` }}>
              <video ref={player.videoRef} playsInline preload="auto" onClick={() => !drawing && player.toggle()} />
              <AtFrame clock={player.clock}>{(frame) => {
                const elsewhere = shapes.length > 0 && drawFrame !== null && drawFrame !== frame;
                const saved = showDrawings ? savedDrawings.filter((d) => d.frame === frame).flatMap((d) => d.shapes) : [];
                return (
                  <>
                    {saved.length > 0 && <DrawingLayer shapes={saved} onChange={() => {}} active={false} tool={tool} color={color} aspect={aspect} />}
                    <DrawingLayer shapes={elsewhere ? [] : shapes} onChange={onShapes} active={drawing && !elsewhere} tool={tool} color={color} aspect={aspect} />
                    {elsewhere && <div className="drawhint"><button className="btn sm" onClick={() => void player.seekToFrame(drawFrame!)}>Your drawing is on {tc(drawFrame!)} · go back</button></div>}
                  </>
                );
              }}</AtFrame>
              {!version && (
                <div className="stage-msg"><div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
                  <span>No versions yet.</span>
                  <button className="btn primary" onClick={newVersion}><Upload size={16} />Upload the first version</button>
                </div></div>
              )}
              {version && !ready && <div className="stage-msg">{version.status === "failed" ? `This version failed: ${version.error ?? "unknown error"}` : `v${version.number} · ${st?.text ?? ""}. It plays here when Bunny is done.`}</div>}
              {player.error && <div className="stage-msg">{player.error}</div>}
            </div>
          </div>
          {narrow && transportBar}

          {ready && (
            <div className="composer-zone">
              {drawing && (
                <div className="drawbar" role="toolbar" aria-label="Drawing tools">
                  {([["pen", <Brush size={16} key="p" />, "Pen"], ["arrow", <MoveUpRight size={16} key="a" />, "Arrow"], ["box", <Square size={16} key="b" />, "Box"], ["ellipse", <Circle size={16} key="e" />, "Circle"]] as const).map(([t, icon, name]) => (
                    <button key={t} className={`icon-btn${tool === t ? " on" : ""}`} onClick={() => setTool(t)} aria-label={name} title={name}>{icon}</button>
                  ))}
                  <span className="vr" />
                  {COLORS.map((c) => <button key={c} className={`sw${color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />)}
                  <span className="vr" />
                  <button className="icon-btn" disabled={!shapes.length} onClick={() => onShapes(shapes.slice(0, -1))} aria-label="Undo" title="Undo"><Undo2 size={16} /></button>
                  <button className="icon-btn" disabled={!shapes.length} onClick={() => onShapes([])} aria-label="Clear drawing" title="Clear"><X size={16} /></button>
                  <button className="btn sm" onClick={() => setDrawing(false)}><Check size={14} />Done</button>
                </div>
              )}
              <div className="composer">
                <button className={`icon-btn tool${drawing ? " on" : ""}`} onClick={() => { player.pause(); setDrawing(!drawing); }} aria-label="Draw (D)" title="Draw (D)"><Pencil size={17} /></button>
                <Menu side="top" label="Note on" trigger={(p) => (
                  <button {...p} className="target" title="What this note is on">
                    <span className="dot" style={{ background: whole ? "var(--mk-video)" : sel ? "var(--mk-range)" : "var(--mk-frame)" }} />
                    {whole ? "Whole video" : sel ? <>{tc(sel.a)} → {tc(sel.b)}</> : <AtFrame clock={player.clock}>{(f) => tc(shapes.length && drawFrame !== null ? drawFrame : f)}</AtFrame>}
                  </button>
                )}>
                  <MenuLabel>Note on</MenuLabel>
                  <MenuItem checked={!whole && !sel} onSelect={() => { setWhole(false); setSel(null); }}>This frame</MenuItem>
                  <MenuItem kbd="I" onSelect={setIn}>Range: start here</MenuItem>
                  <MenuItem kbd="O" onSelect={setOut}>Range: end here</MenuItem>
                  {sel && <MenuItem kbd="X" onSelect={() => setSel(null)}>Clear range</MenuItem>}
                  <MenuItem checked={whole} onSelect={() => { setWhole(!whole); setSel(null); }}>Whole video</MenuItem>
                </Menu>
                <textarea ref={textRef} rows={1} value={text} onChange={(e) => setText(e.target.value)} onFocus={() => player.pause()}
                  placeholder={drawing ? "Add words to your drawing…" : "Leave a note…"} aria-label="Note"
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void post(); } }} />
                <button className="send" onClick={() => void post()} disabled={posting || (!text.trim() && !shapes.length)} aria-label="Add note" title="Add note (Enter)"><ArrowUp size={18} /></button>
              </div>
            </div>
          )}
        </div>

        {panel && (
          <aside className="side" aria-label="Notes and versions">
            <div className="shead">
              <div className="tabs" role="tablist">
                <button role="tab" className="tab" aria-selected={panel === "notes"} onClick={() => setPanel("notes")}>Notes <span className="count">{openCount || ""}</span></button>
                <button role="tab" className="tab" aria-selected={panel === "versions"} onClick={() => setPanel("versions")}>Versions <span className="count">{data.versions.length || ""}</span></button>
              </div>
              <span className="right">
                {panel === "notes" ? (
                  <Menu align="end" label="Filter and sort notes" trigger={(p) => <button {...p} className={`icon-btn${filter !== defaultFilter ? " on" : ""}`} aria-label="Filter and sort notes" title="Filter and sort"><SlidersHorizontal size={15} /></button>}>
                    <MenuLabel>Show</MenuLabel>
                    {(["all", "open", "done"] as const).map((s) => <MenuItem key={s} keepOpen checked={filter.status === s} onSelect={() => setFilter({ ...filter, status: s })}>{s === "all" ? "All notes" : s === "open" ? "Open" : "Done"}</MenuItem>)}
                    <MenuSep />
                    <MenuLabel>Type</MenuLabel>
                    {(["frame", "range", "general"] as const).map((k) => (
                      <MenuItem key={k} keepOpen checked={filter.kinds[k]} icon={<span className="dot" style={{ width: 8, height: 8, borderRadius: "50%", background: kindColor(k) }} />}
                        onSelect={() => setFilter({ ...filter, kinds: { ...filter.kinds, [k]: !filter.kinds[k] } })}>{k === "frame" ? "Frame" : k === "range" ? "Range" : "Whole video"}</MenuItem>
                    ))}
                    <MenuSep />
                    <MenuLabel>Sort</MenuLabel>
                    <MenuItem keepOpen checked={filter.sort === "timecode"} onSelect={() => setFilter({ ...filter, sort: "timecode" })}>Timecode</MenuItem>
                    <MenuItem keepOpen checked={filter.sort === "newest"} onSelect={() => setFilter({ ...filter, sort: "newest" })}>Newest first</MenuItem>
                    {filter !== defaultFilter && <><MenuSep /><MenuItem onSelect={() => setFilter(defaultFilter)}>Reset</MenuItem></>}
                  </Menu>
                ) : (
                  <button className="icon-btn" onClick={newVersion} aria-label="Upload a new version" title="Upload a new version"><Plus size={16} /></button>
                )}
              </span>
            </div>
            <div className="sbody">
              {panel === "notes"
                ? <NotesList notes={version ? notes : []} clock={player.clock} tc={tc} filter={filter} onJump={jump} focusId={focusId} onCopied={showToast} />
                : <VersionsList videoId={data._id} versions={data.versions} current={version?.number ?? null} uploads={uploads} />}
            </div>
          </aside>
        )}
      </div>

      {!narrow && transportBar}

      {dialog === "rename" && <RenameVideo videoId={data._id} title={data.title} onClose={() => setDialog(null)} />}
      {dialog === "starttc" && version && <StartTcDialog versionId={version._id} startTc={startTc} onClose={() => setDialog(null)} onSaved={() => showToast("Start timecode saved")} />}
      {dialog === "keys" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {toast}
    </div>
  );
}

function RenameVideo({ videoId, title, onClose }: { videoId: Id<"videos">; title: string; onClose: () => void }) {
  const rename = useMutation(api.library.renameVideo);
  const [t, setT] = useState(title);
  return (
    <Modal onClose={onClose} label="Rename video">
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => { e.preventDefault(); if (t.trim()) { await rename({ videoId, title: t }); onClose(); } }}>
        <div className="dhead"><h2 className="headline">Rename video.</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <label className="field"><span className="label">Title</span><input className="input" value={t} onChange={(e) => setT(e.target.value)} autoFocus /></label>
        <div className="dfoot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

function StartTcDialog({ versionId, startTc, onClose, onSaved }: { versionId: Id<"versions">; startTc: string; onClose: () => void; onSaved: () => void }) {
  const save = useMutation(api.library.setStartTimecode);
  const [v, setV] = useState(startTc);
  const ok = isValidTc(v.trim());
  return (
    <Modal onClose={onClose} label="Start timecode">
      <form style={{ display: "grid", gap: 18 }} onSubmit={async (e) => { e.preventDefault(); if (!ok) return; await save({ versionId, startTimecode: v.trim() }); onSaved(); onClose(); }}>
        <div className="dhead">
          <div style={{ display: "grid", gap: 6 }}>
            <span className="eyebrow">This version</span>
            <h2 className="headline">Start timecode. <span className="rest">The timecode of the render's first frame. 01:00:00:00 when you render the whole timeline.</span></h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <label className="field"><span className="label">Starts at</span><input className="input tnum" value={v} onChange={(e) => setV(e.target.value)} autoFocus placeholder="01:00:00:00" /></label>
        {!ok && <p className="error">Use HH:MM:SS:FF, like 01:00:00:00.</p>}
        <div className="dfoot"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={!ok}>Save</button></div>
      </form>
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ["Space or K", "Play / pause"], ["← →", "One frame back / forward"], ["⇧ ← →", "One second back / forward"], ["J", "Back one second"], ["L", "Play"],
  ["I / O", "Range start / end at the playhead"], ["X", "Clear the range"], ["⇧ drag the bar", "Mark a range"], ["D", "Draw on the frame"],
  ["Enter", "Write a note (Enter again adds it, ⇧ Enter for a new line)"], ["Home / End", "First / last frame"], ["F", "Full screen"], ["⌘ K", "Search"], ["?", "This list"],
];
function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} label="Keyboard shortcuts">
      <div className="dhead"><h2 className="headline">Keyboard. <span className="rest">Same feel as Resolve.</span></h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <div className="panel">
        {KEYS.map(([k, d]) => <div className="prow" key={k} style={{ minHeight: 40, padding: "8px 14px" }}><span className="kbd" style={{ padding: "0 8px" }}>{k}</span><span className="pr" style={{ fontSize: 13 }}>{d}</span></div>)}
      </div>
    </Modal>
  );
}
