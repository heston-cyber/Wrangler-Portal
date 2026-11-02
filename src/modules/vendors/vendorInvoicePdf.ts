// Phase 3c step 5 · Download PDF on a vendor invoice (731:2769, 731:3341): a plain one-page PDF of what the vendor sent,
// made in the browser (pdf-lib, Helvetica, so no fonts to load). It is the owner's copy for their books; the portal
// keeps no file of it.
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";

export type InvoicePdf = {
  number: string; status: string; vendor: { name: string; businessName: string | null; email: string | null; address: string | null };
  to: string; project: string; booking: string | null; sent: string | null; approved: string | null; paid: string | null;
  lines: Array<{ label: string; qty: string | null; cents: number }>; totalCents: number; note: string | null;
};

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Helvetica (WinAnsi) can't draw every character: swap the common ones and drop the rest.
const safe = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/×/g, "x").replace(/…/g, "...").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function vendorInvoicePdf(d: InvoicePdf): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${safe(d.number)}`);
  pdf.setCreator("WranglerPortal");
  const page = pdf.addPage([612, 792]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.08, 0.09), grey = rgb(0.42, 0.42, 0.44), rule = rgb(0.85, 0.85, 0.86);
  const L = 54, R = 558;
  let y = 738;
  const text = (s: string, x: number, size = 10, f = reg, color = ink) => page.drawText(safe(s), { x, y, size, font: f, color });
  const right = (s: string, size = 10, f = reg, color = ink) => page.drawText(safe(s), { x: R - f.widthOfTextAtSize(safe(s), size), y, size, font: f, color });
  const fit = (s: string, max: number, size = 10, f = reg) => { let t = safe(s); while (t.length > 1 && f.widthOfTextAtSize(t, size) > max) t = t.slice(0, -2) + "."; return t; };
  const line = () => page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.6, color: rule });

  text("INVOICE", L, 10, bold, grey); right(d.status.toUpperCase(), 10, bold, grey); y -= 26;
  text(d.number, L, 24, bold); y -= 34;

  const from = [d.vendor.name, d.vendor.businessName, ...(d.vendor.address ?? "").split(/\n|,\s*(?=\S)/).filter(Boolean), d.vendor.email].filter(Boolean) as string[];
  const top = y;
  text("FROM", L, 8, bold, grey); y -= 14;
  for (const s of from.slice(0, 6)) { text(fit(s, 230), L); y -= 13; }
  const leftEnd = y;
  y = top;
  const meta: Array<[string, string | null]> = [["To", d.to], ["Project", d.project], ["Booking", d.booking], ["Sent", d.sent], ["Approved", d.approved], ["Paid", d.paid]];
  for (const [k, v] of meta) { if (!v) continue; text(k, 330, 9, reg, grey); right(fit(v, 160)); y -= 14; }
  y = Math.min(y, leftEnd) - 18;

  line(); y -= 18;
  text("Description", L, 9, bold, grey); right("Amount", 9, bold, grey); y -= 8; line(); y -= 16;
  for (const l of d.lines.slice(0, 30)) {
    text(fit(l.label || "-", 300), L);
    if (l.qty) page.drawText(safe(l.qty), { x: 380, y, size: 10, font: reg, color: grey });
    right(usd(l.cents)); y -= 18;
    if (y < 140) break;
  }
  line(); y -= 22;
  text("Total", L, 12, bold); right(usd(d.totalCents), 14, bold); y -= 30;
  if (d.note) {
    text("NOTE", L, 8, bold, grey); y -= 14;
    for (const s of safe(d.note).match(/.{1,95}(\s|$)/g)?.slice(0, 6) ?? []) { text(s.trim(), L, 9, reg, grey); y -= 12; }
  }
  page.drawText("Made with WranglerPortal.", { x: L, y: 40, size: 8, font: reg, color: grey });
  const bytes = await pdf.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
