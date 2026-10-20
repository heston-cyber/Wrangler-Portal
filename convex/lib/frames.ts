// Frame and timecode math shared by the backend and the site. Frames are integers from frame 0.
// Non-drop-frame timecode counts at the NOMINAL rate (24 for 23.976), as Resolve does.

export type Fps = { num: number; den: number };

const KNOWN: [number, Fps][] = [
  [23.976, { num: 24000, den: 1001 }],
  [29.97, { num: 30000, den: 1001 }],
  [59.94, { num: 60000, den: 1001 }],
  [47.952, { num: 48000, den: 1001 }],
  [119.88, { num: 120000, den: 1001 }],
];

export function fpsFromFloat(f: number | undefined | null): Fps {
  if (!f || !isFinite(f) || f <= 0) return { num: 24000, den: 1001 };
  for (const [k, v] of KNOWN) if (Math.abs(f - k) < 0.02) return v;
  return { num: Math.round(f), den: 1 };
}
export const fpsValue = (fps: Fps) => fps.num / fps.den;
export const nominal = (fps: Fps) => Math.round(fps.num / fps.den);
export const frameDuration = (fps: Fps) => fps.den / fps.num;

export function tcToFrames(tc: string, nominalFps: number): number {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(tc.trim());
  if (!m) throw new Error(`Bad timecode: ${tc}`);
  const [h, mi, s, f] = m.slice(1).map(Number);
  return ((h * 60 + mi) * 60 + s) * nominalFps + f;
}

export function framesToTc(total: number, nominalFps: number): string {
  const f = total % nominalFps;
  const s = Math.floor(total / nominalFps) % 60;
  const m = Math.floor(total / (nominalFps * 60)) % 60;
  const h = Math.floor(total / (nominalFps * 3600)) % 24;
  return [h, m, s, f].map((x) => String(x).padStart(2, "0")).join(":");
}

// Timecode of a frame of a version, given the version's start timecode.
export function frameTc(frame: number, startTc: string, fps: Fps): string {
  const n = nominal(fps);
  return framesToTc(tcToFrames(startTc, n) + frame, n);
}

export function isValidTc(tc: string): boolean {
  return /^(\d{1,2}):([0-5]\d):([0-5]\d)[:;](\d{2})$/.test(tc.trim());
}
