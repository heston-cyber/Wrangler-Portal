// Phase 5e step 5 · R5: the accountant's CSV files.
import { describe, expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { cell, csv, exportFiles } from "../src/lib/reportsCsv";

const page = {
  from: "2026-01-01", to: "2026-03-31", today: "2026-11-06",
  months: [{ month: "2026-01", paidCents: 80000, invoicedCents: 100000 }, { month: "2026-02", paidCents: 50050, invoicedCents: 0 }],
  byProject: [{ project: "=HYPERLINK(\"http://x\")", client: "Harbor, Coffee", priceCents: 100000, billed: true, costCents: 125000, profitCents: -25000, estimateProfitCents: null }],
  outstanding: { invoices: [{ title: "Final \"one\"", number: "WRNGLR-0040", client: "@evil", due: "2026-09-20", daysLate: 47, cents: 275000, bucket: "31 to 60 days late" }] },
  vendors: [{ vendor: "+Jordan", cents: 30000, invoices: 1 }],
  funnel: { stages: [{ label: "Lead", count: 3 }, { label: "Signed", count: 2 }], leads: 3 },
  detail: { vendorPaid: [{ day: "2026-02-20", vendor: "-Jordan", number: "INV-1", project: null, cents: 30000 }] },
};

describe("Phase 5e · Reports · CSV", () => {
  test("R5 cells: quoting, and text a spreadsheet would run as a formula is made plain; numbers stay numbers", () => {
    expect(cell("plain")).toBe("plain");
    expect(cell("a, b")).toBe('"a, b"');
    expect(cell('say "hi"')).toBe('"say ""hi"""');
    expect(cell("=1+1")).toBe("'=1+1");
    expect(cell("+1")).toBe("'+1");
    expect(cell("-1")).toBe("'-1");
    expect(cell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(cell("\tx")).toBe("'\tx");
    expect(cell(-250)).toBe("-250");
    expect(cell(null)).toBe("");
    expect(csv([["a", 1], ["b", null]])).toBe("a,1\r\nb,\r\n");
  });

  test("R5 files: one report is one CSV; several are a zip with a CSV each; amounts in dollars", () => {
    const one = exportFiles(page as never, ["revenue"], "Wrangler Productions");
    expect(one.name).toBe("wrangler-productions-revenue-by-month-2026-01-01-to-2026-03-31.csv");
    expect(new TextDecoder().decode(one.bytes)).toBe("Month,Invoiced (USD),Paid (USD)\r\n2026-01,1000,800\r\n2026-02,0,500.5\r\n");
    const zip = exportFiles(page as never, ["profit", "outstanding", "vendors", "funnel"], "Wrangler Productions");
    expect(zip.name).toBe("wrangler-productions-reports-2026-01-01-to-2026-03-31.zip");
    const files = unzipSync(zip.bytes);
    expect(Object.keys(files).sort()).toEqual(["lead-to-job-2026-01-01-to-2026-03-31.csv", "outstanding-invoices-2026-01-01-to-2026-03-31.csv", "profit-by-project-2026-01-01-to-2026-03-31.csv", "vendor-costs-2026-01-01-to-2026-03-31.csv"]);
    const profit = strFromU8(files["profit-by-project-2026-01-01-to-2026-03-31.csv"]);
    expect(profit).toContain(`"'=HYPERLINK(""http://x"")","Harbor, Coffee",1000,Yes,1250,-250,`);
    expect(strFromU8(files["outstanding-invoices-2026-01-01-to-2026-03-31.csv"])).toContain(`"Final ""one""",WRNGLR-0040,'@evil,2026-09-20,47,31 to 60 days late,2750`);
    const vendors = strFromU8(files["vendor-costs-2026-01-01-to-2026-03-31.csv"]);
    expect(vendors).toContain("'+Jordan,1,300");
    expect(vendors).toContain("2026-02-20,'-Jordan,INV-1,,300");
    expect(strFromU8(files["lead-to-job-2026-01-01-to-2026-03-31.csv"])).toContain("Signed,2,67%");
  });
});
