// Type or draw a signature and initials (Phase S1: Heston adopts his; S2: clients use the same pad).
// Produces two transparent PNGs, cropped to the ink, in signing-ink navy.
import { useEffect, useRef, useState } from "react";
import { getStroke } from "perfect-freehand";
import "@fontsource/homemade-apple/400.css";

export const INK = "#121e5a";
// Oct 28 (final test): Heston picked Homemade Apple for every typed signature and initials (was Great Vibes).
const FONT = '"Homemade Apple", cursive';

export type PadResult = { method: "typed" | "drawn"; signature: Blob; initials: Blob; signatureUrl: string; initialsUrl: string };

// Only words that start with a letter count, so "Heston Hill (Client 1)" gives "HH", not "HH(" (final test, Oct 28).
export const initialsOf = (name: string) => name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0]!.toUpperCase()).slice(0, 3).join("");

async function typedPng(text: string, px: number): Promise<HTMLCanvasElement> {
  await document.fonts.load(`${px}px ${FONT}`);
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  g.font = `${px}px ${FONT}`;
  // Sized from the ink's measured bounds (the font's ascenders and descenders reach well below a fixed box), with a margin.
  const m = g.measureText(text);
  const pad = Math.ceil(px * 0.3);
  const left = Math.max(0, Math.ceil(m.actualBoundingBoxLeft || 0));
  const asc = Math.ceil(Math.max(m.actualBoundingBoxAscent || 0, px * 0.8));
  const desc = Math.ceil(Math.max(m.actualBoundingBoxDescent || 0, px * 0.3));
  c.width = Math.max(10, Math.ceil(Math.max(m.width, (m.actualBoundingBoxRight || 0)) + left + pad * 2));
  c.height = asc + desc + pad * 2;
  const g2 = c.getContext("2d")!;
  g2.font = `${px}px ${FONT}`; g2.fillStyle = INK; g2.textBaseline = "alphabetic";
  g2.fillText(text, pad + left, pad + asc);
  return c;
}

// The server refuses images over 3000 × 1200 (convex/lib/pngCheck.ts); a long typed name in a wide font can pass that,
// so it's scaled down to fit first.
function fit(src: HTMLCanvasElement, maxW = 2800, maxH = 1100): HTMLCanvasElement {
  const k = Math.min(1, maxW / src.width, maxH / src.height);
  if (k === 1) return src;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.floor(src.width * k)); out.height = Math.max(1, Math.floor(src.height * k));
  const g = out.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

// Crop a canvas to its ink, with a little padding.
function trim(src: HTMLCanvasElement, pad = 8): HTMLCanvasElement {
  const g = src.getContext("2d")!;
  const { width: W, height: H } = src;
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return src;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1 + pad * 2; out.height = y1 - y0 + 1 + pad * 2;
  out.getContext("2d")!.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, pad, pad, x1 - x0 + 1, y1 - y0 + 1);
  return out;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Couldn't make the image"))), "image/png"));

function hasInk(c: HTMLCanvasElement | null) {
  if (!c) return false;
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 16) if (d[i] > 8 && ++n > 40) return true;
  return false;
}

// A canvas you draw on with a finger, pen or mouse.
function DrawBox({ label, height, canvasRef, onChange }: { label: string; height: number; canvasRef: React.MutableRefObject<HTMLCanvasElement | null>; onChange: () => void }) {
  const strokes = useRef<number[][][]>([]);
  const cur = useRef<number[][] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const redraw = () => {
    const c = canvasRef.current; if (!c) return;
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    const k = c.width / c.clientWidth; g.scale(k, k); g.fillStyle = INK;
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      const pts = getStroke(s, { size: 4.2, thinning: 0.6, smoothing: 0.55, streamline: 0.45, simulatePressure: s.every((p) => p[2] === 0.5) });
      if (!pts.length) continue;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
      g.closePath(); g.fill();
    }
  };
  useEffect(() => {
    const c = canvasRef.current, w = wrap.current; if (!c || !w) return;
    const size = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.round(w.clientWidth * dpr); c.height = Math.round(height * dpr); redraw(); };
    size(); const ro = new ResizeObserver(size); ro.observe(w); return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);
  const pt = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, e.pointerType === "pen" ? e.pressure || 0.5 : 0.5]; };
  return (
    <div className="ws-drawbox" ref={wrap}>
      <canvas ref={canvasRef} style={{ height, width: "100%", touchAction: "none", display: "block" }} aria-label={label}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); cur.current = [pt(e)]; redraw(); }}
        onPointerMove={(e) => { if (!cur.current) return; cur.current.push(pt(e)); redraw(); }}
        onPointerUp={() => { if (cur.current && cur.current.length) strokes.current.push(cur.current); cur.current = null; redraw(); onChange(); }}
        onPointerCancel={() => { cur.current = null; redraw(); }} />
      <div className="ws-drawline" aria-hidden />
      <span className="ws-drawlabel">{label}</span>
      <button type="button" className="btn ghost sm ws-clear" onClick={() => { strokes.current = []; cur.current = null; redraw(); onChange(); }}>Clear</button>
    </div>
  );
}

export function SignaturePad({ name, onResult }: { name: string; onResult: (r: PadResult | null) => void }) {
  const [method, setMethod] = useState<"typed" | "drawn">("typed");
  const [initials, setInitials] = useState(() => initialsOf(name));
  const [tick, setTick] = useState(0);
  const sigCanvas = useRef<HTMLCanvasElement | null>(null);
  const iniCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastName = useRef(name);
  useEffect(() => { if (initials === initialsOf(lastName.current)) setInitials(initialsOf(name)); lastName.current = name; }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let dead = false;
    const t = setTimeout(async () => {
      try {
        let sig: HTMLCanvasElement, ini: HTMLCanvasElement;
        if (method === "typed") {
          if (!name.trim() || !initials.trim()) { onResult(null); return; }
          sig = fit(trim(await typedPng(name.trim(), 120))); ini = fit(trim(await typedPng(initials.trim(), 110)));
        } else {
          if (!hasInk(sigCanvas.current) || !hasInk(iniCanvas.current)) { onResult(null); return; }
          sig = trim(sigCanvas.current!); ini = trim(iniCanvas.current!);
        }
        const [a, b] = await Promise.all([toBlob(sig), toBlob(ini)]);
        if (!dead) onResult({ method, signature: a, initials: b, signatureUrl: sig.toDataURL("image/png"), initialsUrl: ini.toDataURL("image/png") });
      } catch { if (!dead) onResult(null); }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [method, name, initials, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ws-pad">
      <div className="tabs" role="tablist">
        <button role="tab" type="button" className="tab" aria-selected={method === "typed"} onClick={() => setMethod("typed")}>Type</button>
        <button role="tab" type="button" className="tab" aria-selected={method === "drawn"} onClick={() => setMethod("drawn")}>Draw</button>
      </div>
      {method === "typed" ? (
        <div className="ws-typed">
          <div className="ws-sigpreview" style={{ fontFamily: FONT }} aria-label="Signature preview">{name.trim() || <span className="ws-faint">Your name</span>}</div>
          <label className="field"><span className="label">Initials</span>
            <input className="input sm" value={initials} maxLength={4} onChange={(e) => setInitials(e.target.value.replace(/[^A-Za-z.\- ]/g, "").toUpperCase())} style={{ width: 120 }} />
          </label>
          <div className="ws-inipreview" style={{ fontFamily: FONT }} aria-label="Initials preview">{initials || <span className="ws-faint">AB</span>}</div>
        </div>
      ) : (
        <div className="ws-drawn">
          <DrawBox label="Sign here" height={150} canvasRef={sigCanvas} onChange={() => setTick((n) => n + 1)} />
          <DrawBox label="Initials" height={110} canvasRef={iniCanvas} onChange={() => setTick((n) => n + 1)} />
        </div>
      )}
    </div>
  );
}
