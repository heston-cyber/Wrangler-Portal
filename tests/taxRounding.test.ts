// Nov 21 (review of the decimal tax fix): tax is worked out in whole numbers, a half cent rounding away from zero on
// each line and on the discount line, the same in the backend and on the page (so Stripe's total check matches).
import { describe, expect, test } from "vitest";
import { totals } from "../convex/invoices";
import { totals as pageTotals } from "../src/modules/payments/common";

describe("tax rounding", () => {
  test("T1: half cents and decimal rates", () => {
    const cases = [
      { lines: [{ qty: 1, unitCents: 3000 }], taxPercent: 7.25, tax: 218 }, // 217.5 (floats read 217.4999…)
      { lines: [{ qty: 1, unitCents: 5000 }], taxPercent: 8.25, tax: 413 }, // 412.5
      { lines: [{ qty: 1, unitCents: 5000 }, { qty: 1, unitCents: 3000 }], discountCents: 3000, taxPercent: 8.25, tax: 413 + 248 - 248 },
      { lines: [{ qty: 2, unitCents: 10000 }], discountCents: 1000, taxPercent: 8, tax: 1520 }, // the Nov 21 test-mode invoice
      { lines: [{ qty: 1, unitCents: 1999 }], taxPercent: 8.625, tax: 172 },
    ];
    for (const c of cases) {
      expect(totals(c).tax, JSON.stringify(c)).toBe(c.tax);
      expect(pageTotals(c)).toEqual(totals(c));
    }
  });
});
