// Drawing on the frame. Shapes are stored in 0–1 picture coordinates so they fit any screen size,
// and the same paths are drawn into the still that Claude reads.
import { useRef, useState } from "react";
import { getStroke } from "perfect-freehand";

export type Tool = "pen" | "arrow" | "box" | "ellipse";
export type Shape =
  | { t: "pen"; pts: [number, number, number][]; c: string; w: number }
  | { t: "arrow" | "box" | "ellipse"; x1: number; y1: number; x2: number; y2: number; c: string; w: number };

export const COLORS = ["#ff3b30", "#ffd60a", "#ffffff", "#30d5ff"];
// Brush sizes (stroke width as a share of the picture width). Medium is the size every drawing used before Oct 21.
export const BRUSH_SIZES = [
  { name: "Fine", w: 0.003, dot: 4 },
  { name: "Medium", w: 0.006, dot: 7 },
  { name: "Bold", w: 0.012, dot: 11 },
] as const;
const WIDTH = 0.006;

function penPath(pts: [number, number, number][], W: number, H: number, w: number) {
  const outline = getStroke(pts.map(([x, y, p]) => [x * W, y * H, p]), { size: w * W * 1.6, thinning: 0.5, smoothing: 0.5, streamline: 0.4, simulatePressure: pts.every((p) => p[2] === 0.5) });
  if (!outline.length) return "";
  return outline.reduce((d, [x, y], i) => d + (i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : ` L${x.toFixed(1)} ${y.toFixed(1)}`), "") + " Z";
}

function arrowHead(s: { x1: number; y1: number; x2: number; y2: number; w: number }, W: number, H: number) {
  const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(14, s.w * W * 4.5);
  const p1 = [x2 - len * Math.cos(a - 0.45), y2 - len * Math.sin(a - 0.45)];
  const p2 = [x2 - len * Math.cos(a + 0.45), y2 - len * Math.sin(a + 0.45)];
  return `M${x2} ${y2} L${p1[0]} ${p1[1]} L${p2[0]} ${p2[1]} Z`;
}

// SVG path data for a shape in a W×H space. Returns [path, filled].
export function shapePath(s: Shape, W: number, H: number): { d: string; fill: boolean }[] {
  if (s.t === "pen") return [{ d: penPath(s.pts, W, H, s.w), fill: true }];
  const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
  if (s.t === "arrow") return [{ d: `M${x1} ${y1} L${x2} ${y2}`, fill: false }, { d: arrowHead(s, W, H), fill: true }];
  if (s.t === "box") {
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    return [{ d: `M${x} ${y} h${w} v${h} h${-w} Z`, fill: false }];
  }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
  return [{ d: `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0`, fill: false }];
}

export function drawShapesOnCanvas(ctx: CanvasRenderingContext2D, shapes: Shape[], W: number, H: number) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of shapes) {
    for (const p of shapePath(s, W, H)) {
      if (!p.d) continue;
      const path = new Path2D(p.d);
      // A thin dark edge keeps marks readable on any picture.
      if (p.fill) {
        ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = Math.max(1.5, W * 0.0015); ctx.stroke(path);
        ctx.fillStyle = s.c; ctx.fill(path);
      } else {
        ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.lineWidth = s.w * W + Math.max(2, W * 0.002); ctx.stroke(path);
        ctx.strokeStyle = s.c; ctx.lineWidth = s.w * W; ctx.stroke(path);
      }
    }
  }
  ctx.restore();
}

export function DrawingLayer({ shapes, onChange, active, tool, color, aspect, width = WIDTH }: {
  shapes: Shape[]; onChange: (s: Shape[]) => void; active: boolean; tool: Tool; color: string; aspect: number; width?: number;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const W = 1000, H = Math.round(1000 / (aspect || 16 / 9));

  const pos = (e: React.PointerEvent): [number, number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)), e.pressure || 0.5];
  };

  return (
    <svg
      ref={ref}
      className={`drawlayer${active ? " active" : ""}`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ pointerEvents: active ? "auto" : "none" }}
      onPointerDown={(e) => {
        if (!active) return;
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        const [x, y, p] = pos(e);
        setDraft(tool === "pen" ? { t: "pen", pts: [[x, y, p]], c: color, w: width } : { t: tool, x1: x, y1: y, x2: x, y2: y, c: color, w: width });
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const [x, y, p] = pos(e);
        setDraft(draft.t === "pen" ? { ...draft, pts: [...draft.pts, [x, y, p]] } : { ...draft, x2: x, y2: y });
      }}
      onPointerUp={() => {
        if (!draft) return;
        const tiny = draft.t !== "pen" && Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 0.01;
        if (!tiny && !(draft.t === "pen" && draft.pts.length < 2)) onChange([...shapes, draft]);
        setDraft(null);
      }}
    >
      {[...shapes, ...(draft ? [draft] : [])].map((s, i) =>
        shapePath(s, W, H).map((p, j) => (
          <path key={`${i}-${j}`} d={p.d} fill={p.fill ? s.c : "none"} stroke={p.fill ? "rgba(0,0,0,.5)" : s.c} strokeWidth={p.fill ? 1.2 : s.w * W} strokeLinecap="round" strokeLinejoin="round" />
        )),
      )}
    </svg>
  );
}
