// The scrub bar in the transport: click to jump, drag to scrub, Shift-drag to mark a range.
// Note markers sit under the bar in Resolve's colours (blue frame, yellow range). Clicking one picks that note.
import { useRef, useState } from "react";
import { useFrame, type FrameClock } from "./useFramePlayer";

export type BarNote = { id: string; kind: "frame" | "range" | "general"; inFrame?: number; outFrame?: number; status: "open" | "done"; text?: string };

export function Scrubber({ clock, frameCount, notes, sel, highlight, activeId, onSeek, onSelect, onPick, label }: {
  clock: FrameClock;
  frameCount: number;
  notes: BarNote[];
  sel: { a: number; b: number } | null;
  highlight?: { a: number; b: number } | null;
  activeId?: string | null;
  onSeek: (f: number) => void;
  onPick: (id: string) => void;
  onSelect: (a: number, b: number) => void;
  label: (f: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useFrame(clock);
  const [drag, setDrag] = useState<{ start: number; range: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(1, frameCount);
  const pct = (f: number) => `${(100 * f) / n}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
  };
  const LANE_TOP = 28; // px: below this, taps pick the nearest note mark instead of moving the playhead
  // Picks the note whose mark is nearest the tap (within 24px), for fingers that land a little off.
  const pickNear = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const px = (f: number) => (f / n) * r.width;
    let best: { id: string; d: number } | null = null;
    for (const m of notes) {
      if (m.inFrame === undefined || m.kind === "general") continue;
      const a = px(m.inFrame), b = m.kind === "range" && m.outFrame !== undefined ? px(m.outFrame + 1) : px(m.inFrame + 0.5);
      const d = m.kind === "range" ? (x < a ? a - x : x > b ? x - b : 0) : Math.abs(x - b);
      if (!best || d < best.d) best = { id: m.id, d };
    }
    if (best && best.d <= 24) onPick(best.id);
  };
  // Overlapping ranges get their own lanes so none hides another.
  const ranges = notes.filter((x) => x.kind === "range" && x.inFrame !== undefined && x.outFrame !== undefined).sort((a, b) => a.inFrame! - b.inFrame!);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const r of ranges) {
    let lane = laneEnds.findIndex((end) => end < r.inFrame!);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(r.outFrame!); } else laneEnds[lane] = r.outFrame!;
    lanes.set(r.id, Math.min(lane, 2));
  }

  return (
    <div
      ref={ref}
      className="scrub"
      role="slider"
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={frame}
      aria-valuetext={label(frame)}
      tabIndex={-1}
      onPointerDown={(e) => {
        const top = ref.current!.getBoundingClientRect().top;
        if (e.clientY - top > LANE_TOP) { e.preventDefault(); pickNear(e.clientX); return; }
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const f = at(e.clientX);
        setDrag({ start: f, range: e.shiftKey });
        if (e.shiftKey) onSelect(f, f);
        onSeek(f);
      }}
      onPointerMove={(e) => {
        const f = at(e.clientX);
        if (!drag && e.clientY - ref.current!.getBoundingClientRect().top > LANE_TOP) { setHover(null); return; }
        setHover(f);
        if (!drag) return;
        if (drag.range) onSelect(Math.min(drag.start, f), Math.max(drag.start, f));
        onSeek(f);
      }}
      onPointerUp={(e) => { setDrag(null); if (e.pointerType !== "mouse") setHover(null); }}
      onPointerLeave={() => { if (!drag) setHover(null); }}
    >
      <div className="lane" aria-hidden />
      <div className="track" />
      <div className="fillbar" style={{ width: pct(frame + 0.5) }} />
      {highlight && <div className="hl" style={{ left: pct(highlight.a), width: `max(3px, ${pct(highlight.b - highlight.a + 1)})` }} />}
      {sel && <div className="sel" style={{ left: pct(sel.a), width: `max(3px, ${pct(sel.b - sel.a + 1)})` }} />}
      {ranges.map((x) => (
        <div key={x.id} className={`rhit${x.id === activeId ? " active" : ""}`} role="button" aria-label={`Range note ${label(x.inFrame!)} to ${label(x.outFrame!)}`}
          title={`${label(x.inFrame!)} → ${label(x.outFrame!)}${x.text ? ` · ${x.text.slice(0, 80)}` : ""}`}
          style={{ left: pct(x.inFrame!), width: `max(8px, ${pct(x.outFrame! - x.inFrame! + 1)})`, top: 50 + 4 * (lanes.get(x.id) ?? 0) }}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onPick(x.id); }}>
          <i className={`rbar${x.status === "done" ? " done" : ""}`} style={{ background: "var(--mk-range)" }} />
        </div>
      ))}
      {notes.filter((x) => x.kind === "frame" && x.inFrame !== undefined).map((x) => (
        <div key={x.id} className={`mkhit${x.id === activeId ? " active" : ""}`} role="button" aria-label={`Note at ${label(x.inFrame!)}`}
          title={`${label(x.inFrame!)}${x.text ? ` · ${x.text.slice(0, 80)}` : ""}`}
          style={{ left: pct(x.inFrame! + 0.5) }}
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); onPick(x.id); }}>
          <i className={`mk${x.status === "done" ? " done" : ""}`} style={{ background: "var(--mk-frame)" }} />
        </div>
      ))}
      <div className="knob" style={{ left: pct(frame + 0.5) }} />
      {hover !== null && <div className="hover" style={{ left: pct(hover + 0.5) }}>{label(hover)}</div>}
    </div>
  );
}
