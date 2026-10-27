// @vitest-environment node
// Wrangler Sign T-S1.1 (Oct 27): markers place boxes where they are, and stamps land exactly in those boxes.
// A PDF is drawn with markers at known spots (one split across two text runs, one on a landscape page, one on a
// page rotated 90°), scanned with the same code the site uses, stamped with the same code the backend uses, and
// the stamped PDF's drawing operations are read back to check where each image ended up.
import { describe, expect, test } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";
import { scanMarkers } from "../src/sign/markers";
import { stamp, type Stamp } from "../convex/lib/wsPdf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const SIZE = 11;

async function contract() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const at: Record<string, { page: number; x: number; y: number; text: string }> = {};
  const put = (page: number, key: string, x: number, y: number, text: string) => { at[key] = { page, x, y, text }; };
  const p1 = d.addPage([612, 792]);
  p1.drawText("Scope of work & deliverables", { x: 72, y: 700, size: SIZE, font: f });
  p1.drawText("Initials:", { x: 72, y: 680, size: SIZE, font: f });
  const ix = 72 + f.widthOfTextAtSize("Initials: ", SIZE);
  p1.drawText("{{initials:client}}", { x: ix, y: 680, size: SIZE, font: f }); put(0, "ini1", ix, 680, "{{initials:client}}");
  p1.drawText("CLIENT:", { x: 72, y: 200, size: SIZE, font: f });
  const sx = 72 + f.widthOfTextAtSize("CLIENT: ", SIZE);
  // A marker split across two text runs, as some exporters write it.
  p1.drawText("{{sign:", { x: sx, y: 200, size: SIZE, font: f });
  p1.drawText("client}}", { x: sx + f.widthOfTextAtSize("{{sign:", SIZE), y: 200, size: SIZE, font: f }); put(0, "sign1", sx, 200, "{{sign:client}}");
  p1.drawText("Date: {{date:client}}", { x: 340, y: 200, size: SIZE, font: f }); put(0, "date1", 340 + f.widthOfTextAtSize("Date: ", SIZE), 200, "{{date:client}}");
  p1.drawText("WRANGLER: {{ sign : Heston }}", { x: 72, y: 160, size: SIZE, font: f }); put(0, "sign2", 72 + f.widthOfTextAtSize("WRANGLER: ", SIZE), 160, "{{ sign : Heston }}");
  const p2 = d.addPage([792, 612]); // landscape, no rotation
  p2.drawText("Second signer: {{sign:client2}}", { x: 400, y: 120, size: SIZE, font: f }); put(1, "sign3", 400 + f.widthOfTextAtSize("Second signer: ", SIZE), 120, "{{sign:client2}}");
  const p3 = d.addPage([612, 792]); p3.setRotation(degrees(90)); // shows sideways on screen
  p3.drawText("Initials: {{initials:client}}", { x: 72, y: 500, size: SIZE, font: f });
  p1.drawText("Plain text {{not a marker}} and {{sign:}} stay as they are.", { x: 72, y: 120, size: SIZE, font: f });
  return { bytes: await d.save(), at, font: f };
}

// Where each image was painted, in PDF user space: [x0, y0, x1, y1] of the unit square under the current matrix.
async function imagePlacements(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const out: Array<{ page: number; rect: [number, number, number, number] }> = [];
  const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  for (let i = 0; i < doc.numPages; i++) {
    const page = await doc.getPage(i + 1);
    const ops = await page.getOperatorList();
    let m = [1, 0, 0, 1, 0, 0]; const stack: number[][] = [];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], args = ops.argsArray[k];
      if (fn === pdfjs.OPS.save) stack.push(m);
      else if (fn === pdfjs.OPS.restore) m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      else if (fn === pdfjs.OPS.transform) m = mul(m, args);
      else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]], ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]];
        out.push({ page: i, rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
      }
    }
  }
  return out;
}

describe("T-S1.1 markers and stamping", async () => {
  const { bytes, at, font } = await contract();
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const scan = await scanMarkers(doc, pdfjs);

  test("every real marker is found, with its kind, signer and page; look-alikes are ignored", () => {
    expect(scan.method).toBe("glyphs");
    const got = scan.markers.map((m) => `${m.kind}:${m.signer}@${m.box.page + 1}${m.check ? "?" : ""}`).sort();
    expect(got).toEqual(["date:client@1", "initials:client@1", "initials:client@3?", "sign:client2@2", "sign:client@1", "sign:heston@1"].sort());
    expect(scan.textPages).toBe(3);
  });

  test("each box starts where its marker starts, and its cover hides exactly the marker", () => {
    const pageH = [792, 612, 792];
    const pageW = [612, 792, 612];
    const check = (key: string, kind: string, signer: string) => {
      const m = scan.markers.find((x) => x.kind === kind && x.signer === signer && x.box.page === at[key].page && !x.check)!;
      const W = pageW[at[key].page], H = pageH[at[key].page];
      const markerW = font.widthOfTextAtSize(at[key].text, SIZE);
      // Box: left edge on the marker's first brace; bottom just under the baseline. (0.6 pt: pdf.js's metrics for an
      // unembedded standard font differ from pdf-lib's by a hair; embedded fonts, what exporters write, are exact.)
      expect(Math.abs(m.box.x * W - at[key].x), key).toBeLessThan(0.6);
      const bottomFromTop = (m.box.y + m.box.h) * H;
      expect(Math.abs(bottomFromTop - (H - at[key].y + SIZE * 0.25))).toBeLessThan(0.25);
      // Cover: half a point either side of the marker, never reaching the words before or after it.
      expect(Math.abs(m.cover.x * W - (at[key].x - 0.5)), key).toBeLessThan(0.6);
      expect(Math.abs(m.cover.w * W - (markerW + 1)), key).toBeLessThan(0.6);
    };
    check("ini1", "initials", "client");
    check("sign1", "sign", "client");
    check("date1", "date", "client");
    check("sign2", "sign", "heston");
    check("sign3", "sign", "client2");
  });

  test("stamped images land exactly in their boxes (unrotated pages), and the original pages are untouched", async () => {
    const stamps: Stamp[] = scan.markers.filter((m) => !m.check && m.kind !== "date").map((m) => ({ box: m.box, cover: m.cover, kind: "image", png: PNG }));
    const out = await stamp(bytes, stamps, ["certificate"]);
    const placed = await imagePlacements(out);
    expect(placed).toHaveLength(stamps.length);
    const pageSize = [[612, 792], [792, 612]];
    for (const s of stamps) {
      const [W, H] = pageSize[s.box.page];
      // A 1x1 image is scaled to the box's height (fit inside, left-aligned, centred vertically).
      const expect0 = { x: s.box.x * W, yTop: H - s.box.y * H, yBottom: H - (s.box.y + s.box.h) * H };
      const hit = placed.find((p) => p.page === s.box.page && Math.abs(p.rect[0] - expect0.x) < 0.01 && p.rect[1] >= expect0.yBottom - 0.01 && p.rect[3] <= expect0.yTop + 0.01);
      expect(hit, `stamp on page ${s.box.page + 1} at x=${expect0.x.toFixed(1)}`).toBeTruthy();
    }
    const orig = await PDFDocument.load(bytes), signed = await PDFDocument.load(out);
    expect(signed.getPageCount()).toBe(orig.getPageCount() + 1);
    expect(signed.getPage(1).getSize()).toEqual(orig.getPage(1).getSize());
    expect(signed.getPage(2).getRotation().angle).toBe(90);
  });
});
