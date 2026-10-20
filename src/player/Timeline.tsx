// The bar under the picture: playhead, note pins and range bars, click to jump, drag to mark a range.
import { useRef, useState } from "react";
import { useFrame, type FrameClock } from "./useFramePlayer";

export type BarNote = { id: string; kind: "frame" | "range" | "general"; inFrame?: number; outFrame?: number; status: "open" | "done" };

export function Timeline({ clock, frameCount, notes, sel, onSeek, onSelect, tickLabel }: {
  clock: FrameClock;
  frameCount: number;
  notes: BarNote[];
  sel: { a: number; b: number } | null;
  onSeek: (f: number) => void;
  onSelect: (a: number, b: number) => void;
  tickLabel: (f: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useFrame(clock);
  const [drag, setDrag] = useState<{ start: number; x0: number; moved: boolean } | null>(null);
  const n = Math.max(1, frameCount);
  const pct = (f: number) => `${(100 * f) / n}%`;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
  };
  // Lanes for overlapping ranges so they don't hide each other.
  const ranges = notes.filter((x) => x.kind === "range" && x.inFrame !== undefined && x.outFrame !== undefined).sort((a, b) => a.inFrame! - b.inFrame!);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const r of ranges) {
    let lane = laneEnds.findIndex((end) => end < r.inFrame!);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(r.outFrame!); } else laneEnds[lane] = r.outFrame!;
    lanes.set(r.id, Math.min(lane, 3));
  }
  const ticks = 6;

  return (
    <div
      ref={ref}
      className="tbar"
      role="slider"
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={frame}
      tabIndex={-1}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const f = at(e.clientX);
        setDrag({ start: f, x0: e.clientX, moved: false });
        onSeek(f);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        if (!drag.moved && Math.abs(e.clientX - drag.x0) < 4) return;
        const f = at(e.clientX);
        setDrag({ ...drag, moved: true });
        onSelect(Math.min(drag.start, f), Math.max(drag.start, f));
        onSeek(f);
      }}
      onPointerUp={() => setDrag(null)}
    >
      {sel && <div className="sel" style={{ left: pct(sel.a), width: pct(sel.b - sel.a + 1) }} />}
      {notes.filter((x) => x.kind === "frame" && x.inFrame !== undefined).map((x) => (
        <div key={x.id} className={`pin${x.status === "done" ? " done" : ""}`} style={{ left: pct(x.inFrame! + 0.5), background: "var(--frame)" }} />
      ))}
      {ranges.map((x) => (
        <div key={x.id} className={`rbar${x.status === "done" ? " done" : ""}`} style={{ left: pct(x.inFrame!), width: pct(x.outFrame! - x.inFrame! + 1), top: 24 + 7 * (lanes.get(x.id) ?? 0), background: "var(--range)" }} />
      ))}
      {Array.from({ length: ticks + 1 }, (_, i) => Math.round(((n - 1) * i) / ticks)).map((f, i) => (
        <span key={i} className="tick" style={{ left: i === 0 ? "28px" : i === ticks ? "calc(100% - 28px)" : pct(f) }}>{tickLabel(f)}</span>
      ))}
      <div className="ph" style={{ left: pct(frame + 0.5) }} />
    </div>
  );
}
