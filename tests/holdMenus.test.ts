// D170/D171 (Heston, Nov 11): hold an item on a phone (or right-click on a computer) for its options.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const hold = read("src/ui/hold.tsx");
const wp = read("src/ui/wp.tsx");
const css = read("src/portal.css");

describe("D170 hold menus", () => {
  it("h.1 every ListRow that opens somewhere has the basic menu, and a page can add to it or turn it off", () => {
    expect(wp).toContain("const spec = menu === undefined ? (to ?");
    expect(wp).toContain("useHold(spec)");
  });
  it("h.2 one host shows the menu: a sheet on phones, the context menu on a computer", () => {
    expect(read("src/shell/Shell.tsx")).toContain("<ItemMenuHost />");
    expect(hold).toMatch(/narrow \? \(\s*<Modal/);
    expect(hold).toContain("<ContextMenu at={open.at}");
  });
  it("h.3 the touch hold waits 480 ms and gives up if the finger moves", () => {
    expect(hold).toContain("const HOLD_MS = 480");
    expect(hold).toContain("const SLOP = 8");
    expect(css).toMatch(/\[data-hold\] \{ -webkit-touch-callout: none/);
  });
  it("h.4 every delete in a hold menu asks first (or opens its own dialog)", () => {
    for (const f of ["src/modules/vendors/Briefings.tsx", "src/modules/production/CallSheets.tsx", "src/modules/proposals/Proposals.tsx", "src/modules/payments/Quotes.tsx", "src/modules/vendors/Vendors.tsx"]) {
      const src = read(f);
      for (const m of src.matchAll(/key: "(delete|archive)"[^\n]*\n?[^\n]*/g)) expect(m[0], `${f}: ${m[1]}`).toContain("confirm:");
    }
  });
  it("h.5 the Contracts menu is the same on both: DocMenu keeps its items, the surface changes", () => {
    const d = read("src/modules/docs/pages/DocMenu.tsx");
    expect(d).toContain("<MenuSurface");
    for (const k of ["Open", "Send for signature…", "Download the signed copy", "Cancel signing…", "Delete…", "Remove from list"]) expect(d).toContain(k);
    expect(read("src/modules/docs/pages/SignDocs.tsx")).toContain("<DocRow");
    expect(read("src/modules/docs/pages/SignHome.tsx")).toContain("<DocRow");
  });
});
