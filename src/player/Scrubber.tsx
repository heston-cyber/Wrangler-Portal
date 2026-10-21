// The scrub bar in the transport: click to jump, drag to scrub, Shift-drag to mark a range.
// Note markers sit under the bar in Resolve's colours (blue frame, yellow range).
import { useRef, useState } from "react";
import { useFrame, type FrameClock } from "./useFramePlayer";

export type BarNote = { id: string; kind: "frame" | "range" | "general"; inFrame?: number; outFrame?: number; status: "open" | "done" };

export function Scrubber({ clock, frameCount, notes, sel, highlight, onSeek, onSelect, label }: {
  clock: FrameClock;
  frameCount: number;
  notes: BarNote[];
  sel: { a: number; b: number } | null;
  highlight?: { a: number; b: number } | null;
  onSeek: (f: number) => void;
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
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const f = at(e.clientX);
        setDrag({ start: f, range: e.shiftKey });
        if (e.shiftKey) onSelect(f, f);
        onSeek(f);
      }}
      onPointerMove={(e) => {
        const f = at(e.clientX);
        setHover(f);
        if (!drag) return;
        if (drag.range) onSelect(Math.min(drag.start, f), Math.max(drag.start, f));
        onSeek(f);
      }}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => { if (!drag) setHover(null); }}
    >
      <div className="track" />
      <div className="fillbar" style={{ width: pct(frame + 0.5) }} />
      {highlight && <div className="hl" style={{ left: pct(highlight.a), width: `max(3px, ${pct(highlight.b - highlight.a + 1)})` }} />}
      {sel && <div className="sel" style={{ left: pct(sel.a), width: `max(3px, ${pct(sel.b - sel.a + 1)})` }} />}
      {notes.filter((x) => x.kind === "frame" && x.inFrame !== undefined).map((x) => (
        <div key={x.id} className={`mk${x.status === "done" ? " done" : ""}`} style={{ left: pct(x.inFrame! + 0.5), background: "var(--mk-frame)" }} />
      ))}
      {ranges.map((x) => (
        <div key={x.id} className={`rbar${x.status === "done" ? " done" : ""}`} style={{ left: pct(x.inFrame!), width: `max(3px, ${pct(x.outFrame! - x.inFrame! + 1)})`, top: 32 + 4 * (lanes.get(x.id) ?? 0), background: "var(--mk-range)" }} />
      ))}
      <div className="knob" style={{ left: pct(frame + 0.5) }} />
      {hover !== null && <div className="hover" style={{ left: pct(hover + 0.5) }}>{label(hover)}</div>}
    </div>
  );
}
