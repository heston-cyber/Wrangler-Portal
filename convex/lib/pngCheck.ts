// Security review (Oct 27): a signer's signature and initials images are checked when they're adopted, not when the
// signed copy is made. A file that only starts like a PNG, or a real PNG that unpacks to something enormous, used to
// be accepted and then stop the signed copy for everyone. This reads the PNG's header, bounds its size, and unpacks
// its image data with a running byte cap, so a bad image is refused at the door.
import { Unzlib } from "fflate";

export const PNG_MAX_W = 3000;
export const PNG_MAX_H = 1200;

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Null if the PNG is sound and small enough to stamp; otherwise what's wrong with it. */
export function pngProblem(b: Uint8Array): string | null {
  if (b.length < 45 || SIG.some((x, i) => b[i] !== x)) return "not a PNG";
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8, w = 0, h = 0, depth = 0, color = -1, sawEnd = false;
  const idat: Uint8Array[] = [];
  while (p + 12 <= b.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (p + 12 + len > b.length) return "cut short";
    const data = b.subarray(p + 8, p + 8 + len);
    if (p === 8 && type !== "IHDR") return "no header";
    if (type === "IHDR") {
      if (len !== 13) return "bad header";
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = b[p + 16]; color = b[p + 17];
      if (b[p + 18] !== 0 || b[p + 19] !== 0 || b[p + 20] !== 0) return "unsupported PNG (interlaced or unusual)";
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") { sawEnd = true; break; }
    p += 12 + len;
  }
  if (!sawEnd) return "cut short";
  if (!w || !h || w > PNG_MAX_W || h > PNG_MAX_H) return `the image is ${w}×${h}; the most is ${PNG_MAX_W}×${PNG_MAX_H}`;
  if (!(color in CHANNELS) || ![1, 2, 4, 8, 16].includes(depth) || (color !== 0 && color !== 3 && depth < 8)) return "unsupported colour format";
  if (!idat.length) return "no image data";
  const rowBytes = Math.ceil((w * CHANNELS[color] * depth) / 8) + 1;
  const expected = rowBytes * h;
  let got = 0, over = false;
  const inf = new Unzlib((chunk) => { got += chunk.length; if (got > expected) { over = true; throw new Error("too big"); } });
  // Fed in 1 KB slices, so a bomb is stopped after about a megabyte of output, not after it has all unpacked.
  const STEP = 1024;
  try {
    idat.forEach((d, i) => {
      for (let o = 0; o < d.length || (o === 0 && !d.length); o += STEP) inf.push(d.subarray(o, o + STEP), i === idat.length - 1 && o + STEP >= d.length);
    });
  } catch { return over ? "image data larger than its size says" : "image data is damaged"; }
  if (got !== expected) return "image data doesn't match its size";
  return null;
}
