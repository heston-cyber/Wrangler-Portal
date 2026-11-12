// D174 (Heston Nov 12): the Dashboard's red button says "Create" and opens one menu of everything that can be made.
// Each item reuses the page or dialog that already makes the thing; a team member only sees what their role allows.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREATE_ITEMS } from "../src/modules/home/CreateMenu";
import { pathNeeds } from "../src/lib/teamAccess";

const menu = readFileSync("src/modules/home/CreateMenu.tsx", "utf8");
const home = readFileSync("src/modules/home/OwnerHome.tsx", "utf8");
const production = readFileSync("src/modules/production/Production.tsx", "utf8");
const css = readFileSync("src/portal.css", "utf8");
const dashboard = home.slice(home.indexOf("<PageHeader"), home.indexOf("<PageHeader") + 1200);

describe("D174 Create menu", () => {
  it("174.1 the Dashboard's red button is Create, not New call sheet", () => {
    expect(home).toContain("<CreateMenu />");
    expect(dashboard).not.toContain("New call sheet");
    expect(menu).toMatch(/Create <ChevronDown/);
    expect(menu).toContain('variant="primary"');
  });

  it("174.2 every thing Heston listed can be created, in his order", () => {
    expect(CREATE_ITEMS.map((i) => i.label)).toEqual(["Invoice", "Proposal", "Quote", "Contract", "Shoot", "Call sheet", "Briefing", "Client"]);
  });

  it("174.3 each item goes to a new-thing page or opens a dialog, never both", () => {
    for (const i of CREATE_ITEMS) expect(Boolean(i.to) !== Boolean(i.dialog), i.key).toBe(true);
    expect(CREATE_ITEMS.filter((i) => i.to).map((i) => i.to)).toEqual([
      "/payments/invoices/new", "/proposals/new", "/payments/quotes/new", "/sign/new", "/production/call-sheets/new",
    ]);
    expect(CREATE_ITEMS.filter((i) => i.dialog).map((i) => i.dialog)).toEqual(["shoot", "briefing", "client"]);
  });

  it("174.4 an item is shown by the same access rule as its page (a stranger sees none, no item is owner-only by accident)", () => {
    for (const i of CREATE_ITEMS) {
      const n = pathNeeds(i.needs);
      expect(Array.isArray(n), `${i.key} needs ${i.needs}`).toBe(true);
    }
    expect(pathNeeds("/payments/invoices/new")).toEqual(["payments"]);
    expect(pathNeeds("/production/shoots")).toEqual(["shoots"]);
    expect(pathNeeds("/clients")).toEqual(["clients"]);
    expect(menu).toMatch(/pathNeeds/);
    expect(menu).toMatch(/!items\.length\) return null/);
  });

  it("174.5 the menu writes nothing itself", () => {
    expect(menu).not.toMatch(/useMutation|useAction|useQuery/);
  });

  it("174.6 a shoot can be made on its own: + New project… inside the shoot dialog, only with the Projects switch", () => {
    const shoot = production.slice(production.indexOf("export function NewShoot"), production.indexOf("export default function"));
    expect(shoot).toContain("+ New project…");
    expect(shoot).toContain("api.library.createProject");
    expect(shoot).toMatch(/mayStart/);
    expect(shoot).not.toContain("No open projects yet");
  });

  it("174.7 the options sheet is lighter glass and rises quickly; reduced motion turns it off", () => {
    expect(css).toMatch(/\.dialog:not\(\[data-full\]\):has\(\.hold-sheet\) \{[^}]*--lg-ink: \.45[^}]*animation: wp-sheet-up 200ms/);
    expect(css).toContain("@keyframes wp-sheet-up");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.backdrop, \.backdrop > \.dialog \{ animation: none/);
  });
});
