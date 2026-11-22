// @vitest-environment node
// Nov 22 (Heston, approved): W3 the will's PDF. Pages numbered "Page N of M" with an initials line; the signature at the
// end of the will and the witnesses after it; then the self-proving declaration page (§55(5)(b)) and the notary page
// (§55(5)(a)); and the signing-day checklist as its own file.
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { ChecklistDoc, WillDoc } from "../src/modules/will/willPdf";
import { blank, willFor } from "../src/modules/will/willText";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
async function pages(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (let p = 1; p <= doc.numPages; p++) out.push((await (await doc.getPage(p)).getTextContent()).items.map((i: any) => i.str).join(" ").replace(/\s+/g, " "));
  return out;
}

const answers = {
  ...blank(),
  a: { name: "Jordan Lee Sample", aka: "", pronoun: "he" as const }, b: { name: "Casey Ann Sample", aka: "", pronoun: "she" as const },
  city: "Oklahoma City", county: "Oklahoma",
  backupExecutor: { name: "Pat Sample", relation: "brother", place: "Edmond, Oklahoma" },
  fallback: [{ name: "Robin Sample", relation: "mother" }],
  guardian: { name: "Alex Kim", relation: "friend", place: "" }, backupGuardian: { name: "Pat Sample", relation: "brother", place: "" },
  giftsA: [{ item: "my camera kit", to: "Pat Sample", backup: "" }],
};

describe("the will PDF", () => {
  it("W3 numbered pages, signature then witnesses at the end, then the declaration and notary pages", async () => {
    const w = willFor(answers, "a");
    const p = await pages(new Uint8Array(await renderToBuffer(<WillDoc w={w} />)));
    const n = p.length;
    expect(n).toBeGreaterThanOrEqual(4);
    p.forEach((t, i) => {
      expect(t, `page ${i + 1}`).toContain(`Last Will and Testament of Jordan Lee Sample · Page ${i + 1} of ${n}`);
      expect(t, `page ${i + 1}`).toContain("Initials:");
    });
    expect(p[0]).toContain("LAST WILL AND TESTAMENT");
    expect(p[0]).toContain("Article I. Revocation");
    const will = p.slice(0, n - 2).join(" ");
    const sig = will.indexOf("Jordan Lee Sample, Testator"), wit = will.indexOf("Witness 1 (signature)"), wit2 = will.indexOf("Witness 2 (signature)");
    expect(will.indexOf("Article IX. General")).toBeLessThan(sig); // every article comes before the signature (§55: at the end)
    expect(sig).toBeLessThan(wit);
    expect(wit).toBeLessThan(wit2);
    expect(will).toContain("Residence address");
    expect(p[n - 2]).toContain("SELF-PROVING DECLARATION");
    expect(p[n - 2]).toContain("§55(5)(b)");
    expect(p[n - 2]).toContain("all of which we declare and sign under penalty of perjury");
    expect(p[n - 2]).toContain("Witness 2 (signature)");
    expect(p[n - 1]).toContain("SELF-PROVING AFFIDAVIT");
    expect(p[n - 1]).toContain("THE STATE OF OKLAHOMA");
    expect(p[n - 1]).toContain("(SEAL)");
    expect(p[n - 1]).toContain("Subscribed and acknowledged before me by the said Jordan Lee Sample, testator");
  }, 30_000);

  it("W3 the signing-day checklist is its own one-page file", async () => {
    const p = await pages(new Uint8Array(await renderToBuffer(<ChecklistDoc />)));
    expect(p.length).toBe(1);
    expect(p[0]).toContain("SIGNING-DAY CHECKLIST");
    expect(p[0]).toContain("Not part of either will.");
    expect(p[0]).toContain("This is my last will and testament, and I’m asking you to witness it.");
  }, 30_000);
});
