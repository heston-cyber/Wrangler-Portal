// Waveform peaks: the loudest sample in each slice of time, 0–255, at a few slices per second.
// Made once per version on the server; the timeline turns them into bars that fit its width.

const MAX_PEAKS = 20_000;

// Slices per second: 20, fewer for long cuts so a version stays under 20,000 peaks (about 20 KB).
export const peakRate = (seconds: number) => Math.max(1, Math.min(20, Math.floor(MAX_PEAKS / Math.max(1, seconds))));

export class PeakMeter {
  private out: number[] = [];
  private cur = 0;
  private n = 0;
  private per = 0;
  constructor(private rate: number) {}

  push(channelData: Float32Array[], sampleRate: number) {
    if (!channelData.length || !sampleRate) return;
    if (!this.per) this.per = Math.max(1, Math.round(sampleRate / this.rate));
    const len = channelData[0].length;
    for (let i = 0; i < len; i++) {
      let m = 0;
      for (const ch of channelData) { const v = ch[i]; const a = v < 0 ? -v : v; if (a > m) m = a; }
      if (m > this.cur) this.cur = m;
      if (++this.n === this.per) { this.out.push(Math.min(255, Math.round(this.cur * 255))); this.cur = 0; this.n = 0; }
    }
  }

  done(): Uint8Array {
    if (this.n > 0) { this.out.push(Math.min(255, Math.round(this.cur * 255))); this.n = 0; this.cur = 0; }
    return Uint8Array.from(this.out);
  }
}

// Bar heights (0–1) for `bars` equal slices of a version `frameCount` frames long.
// Each bar is the loudest peak in its slice, scaled to the loudest moment in the cut and eased so quiet talk still shows.
export function barHeights(peaks: Uint8Array, rate: number, frameCount: number, fpsNum: number, fpsDen: number, bars: number): number[] {
  if (!peaks.length || bars <= 0 || frameCount <= 0) return [];
  let top = 1;
  for (const p of peaks) if (p > top) top = p;
  const secPerFrame = fpsDen / fpsNum;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i / bars) * frameCount * secPerFrame * rate);
    const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * frameCount * secPerFrame * rate));
    let m = 0;
    for (let k = a; k < b && k < peaks.length; k++) if (peaks[k] > m) m = peaks[k];
    out.push(Math.pow(m / top, 0.7));
  }
  return out;
}
