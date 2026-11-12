// Phase 5g (D172, Heston Nov 11): on a phone the sidebar slides in from a menu button, and the rows of chips became one
// path of crumbs (Production › Pre-pro › Briefings) whose crumbs open the pages beside them. Desktop crumbs get the same arrows.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownerItems, trailOf } from "../src/shell/Shell";

const shell = readFileSync("src/shell/Shell.tsx", "utf8");
const css = readFileSync("src/portal.css", "utf8");
const owner = ownerItems(true);
const sectionOf = (path: string) => [...owner.main, ...owner.tabs].find((it) => (it.tab ?? it.match)(path))!;
const trail = (path: string) => trailOf(sectionOf(path), owner.main, path, "owner");

describe("5g phone menu", () => {
  it("5g.1 no phone page draws a chip row any more", () => {
    const phoneTop = shell.slice(shell.indexOf("function PhoneTop"), shell.indexOf("function TabBar"));
    expect(phoneTop).not.toMatch(/wp-chips|wp-layerchip/);
    expect(phoneTop).toContain("NavTrail");
    expect(css).not.toMatch(/has\(\.wp-ptop \.wp-chips\)/);
  });

  it("5g.2 the path says where you are, and the section crumb lists every menu item", () => {
    const t = trail("/vendors/briefings");
    expect(t.map((c) => c.label)).toEqual(["Production", "Pre-pro", "Briefings"]);
    expect(t[0].options.map((o) => o.label)).toEqual(owner.main.map((i) => i.label));
    expect(t[0].options.filter((o) => o.current).map((o) => o.label)).toEqual(["Production"]);
    expect(trail("/production/pre-pro").map((c) => c.label)).toEqual(["Production", "Pre-pro"]);
    expect(trail("/payments/invoices").map((c) => c.label)).toEqual(["Payments", "Invoices"]);
    expect(trail("/proposals/templates").map((c) => c.label)).toEqual(["Docs", "Proposals", "Templates"]);
  });

  it("5g.3 every page in every layer can be reached from a crumb beside where you are", () => {
    for (const it of owner.main) for (const s of it.layer ?? []) {
      if (s.only) continue;
      const t = trail(s.to);
      const reach = t.flatMap((c) => c.options.map((o) => o.to));
      expect(reach, `${it.label} › ${s.label}`).toContain(s.to);
      for (const c of t) {
        expect(new Set(c.options.map((o) => o.to)).size).toBe(c.options.length); // no two options go to the same place
        expect(c.options.filter((o) => o.current).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("5g.4 labelled for keyboard and screen readers; Escape and a swipe close the menu", () => {
    expect(shell).toContain('label="Open menu"');
    expect(shell).toContain('aria-current={i === crumbs.length - 1 ? "location" : undefined}');
    expect(shell).toMatch(/e\.key === "Escape"\) \{ setPhoneMenu\(false\)/);
    expect(shell).toMatch(/clientX - x0 < -60\) onClose\(\)/);
    expect(shell).toContain("Pages beside ${crumb.label}");
  });
});
