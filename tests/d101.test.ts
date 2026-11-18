// D101 (vendors' payment details: the method and a note only) tightened after the Phase 7 reviews (Nov 18): the account
// and routing number check, and the same check over a vendor's own free-text fields.
import { expect, test } from "vitest";
import { accountIn, looksLikeAccount as L } from "../convex/lib/bookings";

test("ordinary notes, dates, prices and one phone number pass", () => {
  for (const s of ["Zelle to 405-555-1234", "Same account as last time", "Shoot day 11/06/2026", "2026.11.06 edit", "$1,500.00", "(405) 555 1234", "FX6, Ronin RS3", "Suite 200, 73106", "Last 4: 6789"]) expect([s, L(s)]).toEqual([s, false]);
});
test("account, routing, card and tax ID numbers are refused however they're written", () => {
  for (const s of ["ACH routing 021.000.021 account 123-456-7890", "acct 1234/5678/9012", "1234_5678_9012", "1234 - 5678 - 9012", "１２３４５６７８９", "card 4242.4242.4242.4242", "SSN 123.45.6789", "Routing 021000021", "000123456789", "405-555-1234 and 405-555-9876"]) expect([s, L(s)]).toEqual([s, true]);
});
test("free-text fields: a portfolio link's address is fine; numbers in the text are not", () => {
  expect(accountIn({ Portfolio: "vimeo.com/123456789", Gear: "FX6" })).toBeNull();
  expect(accountIn({ Portfolio: "Routing 021000021 SSN 123-45-6789" })).toBe("Portfolio");
});
