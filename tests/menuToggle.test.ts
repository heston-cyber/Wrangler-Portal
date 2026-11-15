// D176 (Heston Nov 15): the desktop side menu toggles (hamburger, hover-peek, pin), menu text is plain light (icons stay red),
// every submenu item has its own kind of icon, and the cactus scene is smaller and darker.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ownerItems, STAGE_ICON, STAGE_TO, SUB_ICON, subIcon } from "../src/shell/Shell";

const css = readFileSync("src/portal.css", "utf8");
const shell = readFileSync("src/shell/Shell.tsx", "utf8");
const typeCss = readFileSync("src/type.css", "utf8");
const glass = readFileSync("src/lib/glass.ts", "utf8");
const iconTs = readFileSync("src/ui/Icon.tsx", "utf8");
const d176 = css.slice(css.indexOf("D176"));

describe("D176 side menu toggle", () => {
  it("176.1 the menu starts open and the choice is remembered in the browser", () => {
    expect(shell).toMatch(/localStorage\.getItem\("wp\.menu"\) !== "hidden"/);
    expect(shell).toMatch(/localStorage\.setItem\("wp\.menu", now \? "pinned" : "hidden"\)/);
  });

  it("176.2 three states are marked on the shell: pinned, peek (hover) and hidden", () => {
    expect(shell).toMatch(/data-menu=/);
    for (const s of ["pinned", "peek", "hidden"]) expect(shell).toContain(`"${s}"`);
    expect(css).toContain('data-menu="hidden"');
    expect(css).toContain('data-menu="peek"');
  });

  it("176.3 pinned pushes the page (a spacer the width of the menu); hidden and peek give the room back", () => {
    expect(css).toMatch(/\.wp-sidegap \{[^}]*flex: 0 0 calc\(var\(--sidebar-w\)/);
    expect(css).toMatch(/data-menu="hidden"\] > \.wp-sidegap, \.wp-shell\[data-menu="peek"\] > \.wp-sidegap \{ flex-basis: 0; \}/);
  });

  it("176.4 hidden: the menu slides off to the left and cannot be tabbed into; peek floats over the page", () => {
    expect(css).toMatch(/data-menu="hidden"\] > \.wp-side:not\(\.drawer\) \{ transform: translateX\(calc\(-100% - 24px\)\); visibility: hidden;/);
    expect(css).toMatch(/data-menu="peek"\] > \.wp-side:not\(\.drawer\) \{[^}]*box-shadow: var\(--shadow-float\)/);
  });

  it("176.5 a hamburger sits top left: inside the menu to hide or keep it, and fixed on the page while the menu is away", () => {
    expect(shell).toMatch(/icon="menu" label="Show menu"[^>]*className="wp-deskmenu wp-deskmenu-fixed"/);
    expect(shell).toMatch(/deskMenu\.pinned \? "Hide menu" : "Keep menu open"/);
  });

  it("176.6 hover peeks only with a real pointer, and the button that appears under a clicked pointer is not a hover", () => {
    expect(shell).toContain("pointer: fine");
    expect(shell).toMatch(/armed\.current = false/);
    expect(shell).toMatch(/if \(armed\.current\) peekDesk\(true\)/);
  });

  it("176.7 phones and the work-surface drawer are left alone: the toggle CSS only applies from 821 px up, and not to the drawer", () => {
    expect(d176).toMatch(/@media \(min-width: 821px\)/);
    expect(d176).toMatch(/\.wp-deskmenu \{ display: none;? ?\}/);
    expect(d176).toMatch(/\.wp-sidegap \{ display: none;? ?\}/);
    expect(shell).toMatch(/deskMenu=\{overlay \? undefined/);
    expect(shell).toMatch(/\{!overlay && <div className="wp-sidegap"/);
  });

  it("176.8 Reduce Motion: the menu still moves to its place, with no sliding", () => {
    expect(d176).toMatch(/prefers-reduced-motion: reduce[\s\S]*wp-sidegap[\s\S]*transition: none/);
  });
});

describe("D176 plain menu text, icons by kind", () => {
  const { main } = ownerItems(true);
  const subs = main.flatMap((i) => i.layer ?? []);

  it("176.9 no red menu text: stage names and the stage Overview row are plain light text", () => {
    const stage = css.match(/\.wp-side [^{]*stage[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of stage) expect(rule).not.toMatch(/color:\s*var\(--accent\)(?!-)/);
    expect(css).toMatch(/var\(--text-secondary\)/);
    expect(d176 + css).not.toMatch(/\.wp-stagename[^{]*\{[^}]*color:\s*var\(--accent\)/);
  });

  it("176.10 every submenu item in the owner's menu has an icon of its own kind (none falls back to the folder)", () => {
    const missing = subs.filter((s) => !(s.to in SUB_ICON)).map((s) => s.to);
    expect(missing).toEqual([]);
  });

  it("176.11 the same kind has the same icon, different kinds differ (New proposal and New contract share, Invoices and Quotes do not)", () => {
    expect(subIcon("/proposals/new")).toBe(subIcon("/sign/new"));
    expect(subIcon("/proposals/templates")).toBe(subIcon("/sign/templates"));
    expect(subIcon("/payments/invoices")).not.toBe(subIcon("/payments/quotes"));
    expect(subIcon("/clients/pipeline")).not.toBe(subIcon("/clients/follow-ups"));
    expect(subIcon("/some-shared-project-id")).toBe("folder");
  });

  it("176.12 every stage row (Pre-pro, Prin-pro, Post-pro, Delivery, Proposals, Contracts, Clients, Vendors) has a stage icon", () => {
    for (const g of Object.keys(STAGE_TO)) expect(STAGE_ICON[g], g).toBeTruthy();
  });

  it("176.13 every icon name used exists as an SVG, is declared, and keeps the set's drawing rules (24 px, currentColor)", () => {
    const names = new Set([...Object.values(SUB_ICON), ...Object.values(STAGE_ICON)]);
    for (const n of names) {
      const f = `src/assets/icons/${n}.svg`;
      expect(existsSync(f), f).toBe(true);
      const svg = readFileSync(f, "utf8");
      expect(svg, f).toMatch(/width="24" height="24"/);
      expect(svg, f).toContain("currentColor");
      expect(iconTs, n).toContain(`"${n}"`);
    }
  });
});

describe("D176 the cactus scene, smaller and darker", () => {
  it("176.14 the page and the glass use the new baked images, and the files exist (desktop and phone, webp and jpg)", () => {
    for (const v of ["desktop", "phone"]) for (const e of ["jpg", "webp"]) expect(existsSync(`public/bg/cactus-${v}-2.${e}`), `${v}.${e}`).toBe(true);
    expect(typeCss).toContain("cactus-desktop-2");
    expect(typeCss).toContain("cactus-phone-2");
    expect(glass).toContain("cactus-");
    expect(glass).toMatch(/-2/);
    expect(typeCss + glass).not.toMatch(/cactus-(desktop|phone)\.(jpg|webp)/);
  });

  it("176.15 the originals and the recipe are kept so the scene can be rebaked", () => {
    expect(existsSync("scripts/bg/make-dark.py")).toBe(true);
    expect(existsSync("scripts/bg/source/cactus-desktop.jpg")).toBe(true);
    expect(existsSync("scripts/bg/source/cactus-phone.jpg")).toBe(true);
  });
});
