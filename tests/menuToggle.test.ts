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

describe("D176 side menu toggle (follow-up Nov 15 13:34: shrink to the icons, or expand to the full width)", () => {
  it("176.1 the menu starts full width and the choice is remembered in the browser (an older 'hidden' reads as the rail)", () => {
    expect(shell).toMatch(/!\/\^\(rail\|hidden\)\$\/\.test\(localStorage\.getItem\("wp\.menu"\)/);
    expect(shell).toMatch(/localStorage\.setItem\("wp\.menu", now \? "pinned" : "rail"\)/);
  });

  it("176.2 three states are marked on the shell: pinned, rail (icons only) and peek (hovering the rail); none hides it", () => {
    expect(shell).toMatch(/data-menu=\{overlay \? undefined : pinned \? "pinned" : peeking \? "peek" : "rail"\}/);
    expect(css).toContain('data-menu="rail"');
    expect(css).toContain('data-menu="peek"');
    expect(css).not.toContain('data-menu="hidden"');
    expect(css).not.toMatch(/translateX\(calc\(-100% - 24px\)\)/);
  });

  it("176.3 pinned pushes the page by the full menu; the rail and the peek push it by the rail only (the peek floats over)", () => {
    expect(css).toMatch(/\.wp-sidegap \{[^}]*flex: 0 0 calc\(var\(--sidebar-w\) \+ 12px\)/);
    expect(css).toMatch(/data-menu="rail"\] > \.wp-sidegap, \.wp-shell\[data-menu="peek"\] > \.wp-sidegap \{ flex-basis: calc\(var\(--rail-w\) \+ 12px\); \}/);
    expect(css).toMatch(/--rail-w: 80px/);
  });

  it("176.4 the rail keeps the icons where they were and drops names, pages under a section, the logo, bell and search; the section you're in is highlighted", () => {
    expect(css).toMatch(/data-menu="rail"\] > \.wp-side:not\(\.drawer\) \{ width: var\(--rail-w\); \}/);
    expect(css).toMatch(/data-menu="rail"\] > \.wp-side:not\(\.drawer\) :is\(\.wp-sub, \.wp-stagewrap, \.wp-recent, \.wp-layerlabel, \.layer-toggle, \.wp-upload, \.wp-brandl > a, \.wp-brandr,/);
    expect(css).toMatch(/data-menu="rail"\] > \.wp-side:not\(\.drawer\) \.wp-nav\.in \{ background/);
    expect(shell).toMatch(/!it\.match\(path\) && it\.layerHas\?\.\(path\) \? " in"/);
    expect(css).toMatch(/data-menu="peek"\] > \.wp-side:not\(\.drawer\) \{[^}]*box-shadow: var\(--shadow-float\)/);
  });

  it("176.5 the hamburger stays in the menu's top row in every state: it shrinks the menu to icons or keeps it open", () => {
    expect(shell).toMatch(/deskMenu\.pinned \? "Shrink menu to icons" : "Keep menu open"/);
    expect(shell).not.toContain("wp-deskmenu-fixed");
  });

  it("176.6 hovering the rail opens it after a moment (only with a real pointer); right after a click it waits until the pointer has left the menu", () => {
    expect(shell).toContain("pointer: fine");
    expect(shell).toMatch(/setTimeout\(\(\) => setPeeking\(true\), 120\)/);
    expect(shell).toMatch(/armed\.current = false/);
    expect(shell).toMatch(/closest\?\.\("\.wp-side"\)\) \{ armed\.current = true/);
  });

  it("176.7 phones and the work-surface drawer are left alone: the toggle CSS only applies from 821 px up, and not to the drawer", () => {
    expect(d176).toMatch(/@media \(min-width: 821px\)/);
    expect(d176).toMatch(/\.wp-deskmenu \{ display: none;? ?\}/);
    expect(d176).toMatch(/\.wp-sidegap \{ display: none;? ?\}/);
    expect(shell).toMatch(/deskMenu=\{overlay \? undefined/);
    expect(shell).toMatch(/\{!overlay && <div className="wp-sidegap"/);
  });

  it("176.8 Reduce Motion: the menu still changes width, with no animation", () => {
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
