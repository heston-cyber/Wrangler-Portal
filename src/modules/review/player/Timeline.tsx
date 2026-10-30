// The timeline under the picture (Option C, Oct 21): a notes bar, a timecode ruler, and the cut's waveform.
// Click or drag the ruler or waveform to move the playhead; Shift-drag to mark a range.
// While dragging, the playhead follows the finger at once and the picture catches up (onScrub); letting go lands exactly (onSeek).
// Notes sit on their own bar on top in Resolve's colours (blue frame, yellow range); tapping it picks the nearest note.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFrame, type FrameClock } from "./useFramePlayer";
import { barHeights } from "../../../../convex/lib/peaks";

export type BarNote = { id: string; kind: "frame" | "range" | "general"; inFrame?: number; outFrame?: number; status: "open" | "done"; text?: string };
export type Wave = { status: "pending" | "running" | "done" | "none" | "failed"; rate: number | null; peaks: ArrayBuffer | null } | null;

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]; // seconds between ticks
const BAR_PITCH = 6; // px per waveform bar (2px bar, 4px gap)

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

type Tick = { x: number; kind: 0 | 1 | 2; text?: string };

// Ticks on whole timecode seconds: small ones a few px apart, taller ones in between, labelled ones with room for a timecode.
function rulerTicks(frameCount: number, nom: number, startFrames: number, width: number, compact: boolean, label: (f: number) => string): Tick[] {
  if (!width || frameCount < 2) return [];
  const pxPerSec = (width / frameCount) * nom;
  const minor = STEPS.find((s) => s * pxPerSec >= 7) ?? 3600;
  const major = STEPS.find((s) => s * pxPerSec >= (compact ? 64 : 104) && s % minor === 0) ?? 3600;
  const mid = STEPS.find((s) => s > minor && s < major && major % s === 0 && s % minor === 0 && s * pxPerSec >= 28);
  const step = minor * nom;
  const first = (step - (startFrames % step)) % step;
  const out: Tick[] = [];
  const labelRoom = compact ? 34 : 70;
  for (let f = first; f < frameCount; f += step) {
    const sec = Math.round((startFrames + f) / nom);
    const x = (f / frameCount) * width;
    const kind = sec % major === 0 ? 2 : mid && sec % mid === 0 ? 1 : 0;
    out.push({ x, kind, text: kind === 2 && x < width - labelRoom ? label(f) : undefined });
  }
  return out;
}

const MIN_BAR = 22, MAX_BAR = 160;
const Bars = memo(function Bars({ heights }: { heights: number[] }) {
  return <>{heights.map((h, i) => <i key={i} style={{ height: `${Math.max(8, Math.round(h * 100))}%` }} />)}</>;
});

export function Timeline({ clock, frameCount, nom, startFrames, notes, sel, highlight, activeId, onSeek, onScrub, onSelect, onPick, label, wave, fps, compact }: {
  clock: FrameClock;
  frameCount: number;
  nom: number; // nominal frames per second (24 for 23.976)
  startFrames: number; // frame 0's timecode, in frames
  notes: BarNote[];
  sel: { a: number; b: number } | null;
  highlight?: { a: number; b: number } | null;
  activeId?: string | null;
  onSeek: (f: number) => void; // exact jump, when the finger or mouse lets go
  onScrub: (f: number, first: boolean) => void; // quick follow while dragging
  onPick: (id: string) => void;
  onSelect: (a: number, b: number) => void;
  label: (f: number) => string;
  wave: Wave | undefined;
  fps: { num: number; den: number };
  compact?: boolean;
}) {
  const n = Math.max(1, frameCount);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [drag, setDrag] = useState<{ start: number; range: boolean; f: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pct = (f: number) => `${(100 * f) / n}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
  };

  const short = (f: number) => label(f).slice(3, 8); // mm:ss on phones
  const ticks = useMemo(() => rulerTicks(n, nom, startFrames, width, !!compact, compact ? short : label), [n, nom, startFrames, width, compact, label]); // eslint-disable-line react-hooks/exhaustive-deps

  const peaks = useMemo(() => (wave?.status === "done" && wave.peaks ? new Uint8Array(wave.peaks) : null), [wave]);
  const barCount = Math.max(0, Math.floor((width - 12) / BAR_PITCH));
  const heights = useMemo(() => (peaks && wave?.rate ? barHeights(peaks, wave.rate, n, fps.num, fps.den, barCount) : []), [peaks, wave?.rate, n, fps.num, fps.den, barCount]);

  // The notes bar's height: drag its bottom edge to stretch it (Heston, Oct 29), so stacked ranges spread out and are
  // easier to pick. Remembered on this device; a double-click on the edge puts it back.
  const barRef = useRef(MIN_BAR);
  // The resize grip lives on the top edge of the box the timeline sits in (the review page's transport).
  const [gripHost, setGripHost] = useState<HTMLElement | null>(null);
  useEffect(() => { setGripHost(ref.current?.closest<HTMLElement>(".transport") ?? null); }, [ref]);
  // Until it's been dragged, the bar grows on its own to give each track about 8 px (up to 80 px).
  const [userH, setUserH] = useState<number | null>(() => { try { const v = Number(localStorage.getItem("wp.tlNotesH")); return v >= MIN_BAR && v <= MAX_BAR ? v : null; } catch { return null; } });
  const saveH = (h: number | null) => { setUserH(h); try { if (h === null) localStorage.removeItem("wp.tlNotesH"); else localStorage.setItem("wp.tlNotesH", String(h)); } catch { /* private window */ } };
  const startResize = (e: React.PointerEvent, dir: 1 | -1 = -1) => {
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY, h0 = barRef.current;
    // The grip is the timeline box's top edge, so dragging up makes the bar taller.
    // Computers: the grip is the timeline box's top edge, so dragging up makes it taller (dir -1). Phones keep the
    // grip under the notes bar, where dragging down makes it taller (dir 1; Heston: "the mobile resizer is fine").
    const move = (m: PointerEvent) => saveH(Math.round(Math.max(MIN_BAR, Math.min(MAX_BAR, h0 + dir * (m.clientY - y0)))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  // Tracks, like clips in Resolve (Heston, Oct 29): every frame and range note sits on a track; notes that would touch
  // or overlap on screen go on the next track up, so none hides another. Whole-video notes aren't on the timeline.
  const ranges = notes.filter((x) => x.kind === "range" && x.inFrame !== undefined && x.outFrame !== undefined);
  const marks = notes.filter((x) => x.kind === "frame" && x.inFrame !== undefined);
  const fpp = n / Math.max(1, width); // frames per pixel
  const spanOf = (x: BarNote) => {
    const a = x.inFrame!;
    const minEnd = a + Math.ceil((x.kind === "range" ? 8 : 6) * fpp);
    return { a, b: Math.max(x.kind === "range" ? x.outFrame! : a, minEnd) + Math.ceil(2 * fpp) }; // 2 px breathing room
  };
  const placed = [...ranges, ...marks].map((x) => ({ x, ...spanOf(x) })).sort((p, q) => p.a - q.a || q.b - p.b);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const p of placed) {
    let lane = laneEnds.findIndex((end) => end < p.a);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(p.b); } else laneEnds[lane] = p.b;
    lanes.set(p.x.id, lane);
  }
  const oneLane = laneEnds.length <= 1;
  const barH = userH ?? Math.max(MIN_BAR, Math.min(80, laneEnds.length * 10 + 4));
  barRef.current = barH;
  // As many tracks as fit the bar's height (at least 3); each gets an even share, 4–14 px. Stretch the bar for more.
  const GAP = 2, room = barH - 6;
  const maxLanes = Math.max(3, Math.floor((room + GAP) / (4 + GAP)));
  const laneCount = Math.min(laneEnds.length, maxLanes);
  const laneH = oneLane ? Math.min(14, barH - 8) : Math.max(4, Math.min(14, (room - (laneCount - 1) * GAP) / Math.max(1, laneCount)));
  const laneTop = (id: string) => oneLane ? Math.round((barH - laneH) / 2) : 3 + Math.min(lanes.get(id) ?? 0, maxLanes - 1) * (laneH + GAP);

  // Taps on the notes bar pick the note whose mark is nearest (within 24px), for fingers that land a little off.
  // With stacked tracks, the track under the pointer counts too: a note on that track wins over one above or below it.
  const pickNear = (clientX: number, clientY: number, barTop: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - barTop;
    const px = (f: number) => (f / n) * r.width;
    let best: { id: string; d: number } | null = null;
    for (const m of notes) {
      if (m.inFrame === undefined || m.kind === "general") continue;
      const a = px(m.inFrame), b = m.kind === "range" && m.outFrame !== undefined ? px(m.outFrame + 1) : px(m.inFrame + 0.5);
      const dx = m.kind === "range" ? (x < a ? a - x : x > b ? x - b : 0) : Math.abs(x - b);
      if (dx > 24) continue;
      const top = laneTop(m.id), dy = y < top - GAP / 2 ? top - GAP / 2 - y : y > top + laneH + GAP / 2 ? y - (top + laneH + GAP / 2) : 0;
      const d = dx + dy * 4;
      if (!best || d < best.d) best = { id: m.id, d };
    }
    if (best) onPick(best.id);
  };

  const waveNote = !wave || wave.status === "pending" || wave.status === "running" ? "Making the waveform…" : wave.status === "none" ? "No audio" : wave.status === "failed" ? "No waveform" : null;

  const grip = gripHost && createPortal(
    <span className="tl-grip" role="separator" aria-orientation="horizontal" aria-label="Drag up or down to resize the notes bar" title="Drag to resize the notes bar · double-click to reset"
      onPointerDown={startResize} onDoubleClick={(e) => { e.stopPropagation(); saveH(null); }} />,
    gripHost,
  );
  return (
    <div className={`tl${compact ? " compact" : ""}`} ref={ref}>
      {grip}
      <div className="tl-notes" aria-label="Notes on the timeline" style={{ height: barH, ["--tlh" as string]: `${barH}px` }} onPointerDown={(e) => { e.preventDefault(); pickNear(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect().top); }}>
        {ranges.map((x) => (
          <div key={x.id} className={`tl-range${x.status === "done" ? " done" : ""}${x.id === activeId ? " active" : ""}`} role="button" aria-label={`Range note ${label(x.inFrame!)} to ${label(x.outFrame!)}`}
            title={`${label(x.inFrame!)} → ${label(x.outFrame!)}${x.text ? ` · ${x.text.slice(0, 80)}` : ""}`}
            style={{ left: pct(x.inFrame!), width: `max(8px, ${pct(x.outFrame! - x.inFrame! + 1)})`, top: laneTop(x.id), height: laneH }} />
        ))}
        {marks.map((x) => (
          <div key={x.id} className={`tl-mark${x.status === "done" ? " done" : ""}${x.id === activeId ? " active" : ""}`} role="button" aria-label={`Note at ${label(x.inFrame!)}`}
            title={`${label(x.inFrame!)}${x.text ? ` · ${x.text.slice(0, 80)}` : ""}`} style={{ left: pct(x.inFrame! + 0.5), top: laneTop(x.id), height: laneH }} />
        ))}
        <Head clock={clock} n={n} at={drag?.f} className="tl-notehead" />
        <span className="tl-notes-grip" role="separator" aria-orientation="horizontal" aria-label="Drag to make the notes bar taller or shorter" title="Drag to resize · double-tap to reset"
          onPointerDown={(e) => startResize(e, 1)} onDoubleClick={(e) => { e.stopPropagation(); saveH(null); }} />
      </div>

      <div
        className="tl-scrub"
        role="slider"
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuetext={label(clock.get())}
        tabIndex={-1}
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          const f = at(e.clientX);
          setDrag({ start: f, range: e.shiftKey, f });
          setHover(f);
          if (e.shiftKey) onSelect(f, f);
          onScrub(f, true);
        }}
        onPointerMove={(e) => {
          const f = at(e.clientX);
          if (e.pointerType === "mouse" || drag) { if (f !== hover) setHover(f); }
          if (!drag || f === drag.f) return;
          setDrag({ ...drag, f });
          if (drag.range) onSelect(Math.min(drag.start, f), Math.max(drag.start, f));
          onScrub(f, false);
        }}
        onPointerUp={(e) => { if (drag) onSeek(drag.f); setDrag(null); if (e.pointerType !== "mouse") setHover(null); }}
        onPointerCancel={() => { if (drag) onSeek(drag.f); setDrag(null); setHover(null); }}
        onPointerLeave={() => { if (!drag) setHover(null); }}
      >
        <div className="tl-ruler">
          {ticks.map((t, i) => <span key={i} className={`tk k${t.kind}`} style={{ left: t.x }} />)}
          {ticks.filter((t) => t.text).map((t, i) => <span key={`l${i}`} className="tl-label" style={{ left: t.x }}>{t.text}</span>)}
          {sel && <><span className="tl-dia" style={{ left: pct(sel.a) }} /><span className="tl-dia" style={{ left: pct(sel.b + 1) }} /></>}
        </div>
        <div className="tl-wave">
          {heights.length > 0 ? (
            <>
              <div className="bars"><Bars heights={heights} /></div>
              <Played clock={clock} n={n} at={drag?.f}><div className="bars played"><Bars heights={heights} /></div></Played>
            </>
          ) : (
            <><span className="flat" />{waveNote && <span className="wnote">{waveNote}</span>}</>
          )}
          {highlight && <div className="tl-hl" style={{ left: pct(highlight.a), width: `max(3px, ${pct(highlight.b - highlight.a + 1)})` }} />}
          {sel && <div className="tl-sel" style={{ left: pct(sel.a), width: `max(3px, ${pct(sel.b - sel.a + 1)})` }} />}
        </div>
        {hover !== null && <><div className="tl-hover" style={{ left: pct(hover + 0.5) }} /><div className="tl-tip" style={{ left: `clamp(40px, ${pct(hover + 0.5)}, calc(100% - 40px))` }}>{label(hover)}</div></>}
        <Head clock={clock} n={n} at={drag?.f} className="tl-head" />
      </div>
    </div>
  );
}

// Per-frame pieces re-render alone, not the whole timeline.
// `at` (while dragging) shows where the finger is, ahead of the picture.
function Head({ clock, n, className, at }: { clock: FrameClock; n: number; className: string; at?: number }) {
  const live = useFrame(clock);
  const f = at ?? live;
  return <div className={className} style={{ left: `${(100 * (f + 0.5)) / n}%` }} />;
}
function Played({ clock, n, children, at }: { clock: FrameClock; n: number; children: React.ReactNode; at?: number }) {
  const live = useFrame(clock);
  const f = at ?? live;
  return <div className="tl-played" style={{ clipPath: `inset(0 ${100 - (100 * (f + 0.5)) / n}% 0 0)` }}>{children}</div>;
}
