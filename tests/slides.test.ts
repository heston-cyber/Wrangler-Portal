// D175 (Heston Nov 12): on desktop, changing pages, tabs and menus slides quickly. Direction follows the menu order;
// phones and "reduce motion" keep the plain look; nothing here animates opacity (it delays the glass blur behind it).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { navRank, nextSlide, slideDir } from "../src/lib/motion";
import { ownerItems } from "../src/shell/Shell";

const css = readFileSync("src/portal.css", "utf8");
const shell = readFileSync("src/shell/Shell.tsx", "utf8");
const wp = readFileSync("src/ui/wp.tsx", "utf8");
const d175 = css.slice(css.indexOf("D175 (Heston, Nov 12"));
const desk = d175.slice(d175.indexOf("@media (prefers-reduced-motion: no-preference) {"));

describe("D175 slides", () => {
  const items = [...ownerItems(true).main, ...ownerItems(true).tabs];

  it("175.1 a later item in the menu slides in from the right, an earlier one from the left", () => {
    expect(slideDir(items, "/", "/payments")).toBe("f");
    expect(slideDir(items, "/payments", "/")).toBe("b");
    expect(slideDir(items, "/production", "/clients/overview")).toBe("f"); // Nov 16: Production comes before Clients
    expect(slideDir(items, "/messages", "/projects")).toBe("f");
  });

  it("175.2 inside one item, the pages of its layer follow the layer's order; deeper is forward, back is back", () => {
    expect(slideDir(items, "/payments", "/payments/invoices")).toBe("f");
    expect(slideDir(items, "/payments/reports", "/payments/invoices")).toBe("b");
    expect(slideDir(items, "/payments/invoices", "/payments/invoices/new")).toBe("f");
    expect(slideDir(items, "/payments/invoices/new", "/payments/invoices")).toBe("b");
  });

  it("175.3 two pages of the same place and depth don't slide, and the same page never does", () => {
    expect(slideDir(items, "/v/abc", "/v/def")).toBeNull();
    expect(slideDir(items, "/payments", "/payments")).toBeNull();
    expect(navRank(items, "/payments")).toBeGreaterThan(navRank(items, "/"));
  });

  it("175.4 the retrigger alternates 0 and 1 so a second change replays the slide", () => {
    expect(nextSlide(undefined, "f")).toBe("f0");
    expect(nextSlide("f0", "f")).toBe("f1");
    expect(nextSlide("f1", "b")).toBe("b0");
  });

  it("175.5 every slide lives inside the motion-allowed query (desktop and phones); reduce motion gets none", () => {
    expect(desk.length).toBeGreaterThan(1000);
    for (const sel of ['.main[data-slide="f0"] > :not(.topbar)', "[data-tabsrow] ~ *", ".tabs-hl", ".wp-hl", ".menu { animation: wp-menu-in"]) {
      expect(desk, sel).toContain(sel);
      expect(d175.slice(0, d175.indexOf(sel)).includes("@media (prefers-reduced-motion: no-preference) {"), sel).toBe(true);
    }
    expect(d175).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.wp-hl, \.tabs-hl \{ display: none; \} \}/);
    expect(readFileSync("src/lib/motion.ts", "utf8")).toContain("(prefers-reduced-motion: no-preference)");
  });

  it("175.6 only transform (and size) moves: no keyframe or transition on these slides touches opacity", () => {
    for (const k of ["wp-slide-f0", "wp-slide-f1", "wp-slide-b0", "wp-slide-b1", "wp-menu-in"]) {
      const at = css.indexOf(`@keyframes ${k}`); const line = css.slice(at, css.indexOf("\n", at));
      expect(line, k).not.toMatch(/opacity/);
    }
    for (const sel of [".tabs[data-ready] .tabs-hl {", ".wp-side .scroll[data-ready] .wp-hl {"]) {
      const at = desk.indexOf(sel); const line = desk.slice(at, desk.indexOf("}", at));
      expect(line, sel).not.toMatch(/opacity/);
      expect(line, sel).toContain("transform 200ms");
    }
  });

  it("175.7 the page slide runs from the shell when the path changes, on desktop only, and leaves the crumb bar still", () => {
    expect(shell).toMatch(/deskMotion\(\)/);
    expect(shell).toContain('pulse(el, "data-slide"');
    expect(desk).toContain(":not(.topbar):not(canvas)");
  });

  it("175.8 the pill tabs move a highlight and slide the content under them, on desktop only", () => {
    expect(wp).toContain('className="tabs-hl"');
    expect(wp).toContain("deskMotion()");
    expect(wp).toContain('"data-tslide"');
  });

  it("175.10 a change of page by the browser's back (swipe from the edge, back button) doesn't slide a second time", () => {
    const router = readFileSync("src/lib/router.ts", "utf8");
    expect(router).toContain('addEventListener("popstate", () => { byBrowser = true; })');
    expect(router).toContain("byBrowser = false;");
    expect(shell).toContain("cameBackByBrowser()");
  });

  it("175.9 the sidebar highlight is three pills that follow the current items", () => {
    expect((shell.match(/<span className="wp-hl" aria-hidden \/>/g) ?? []).length).toBe(3);
    expect(shell).toContain('.wp-nav[aria-current=page], .wp-sub[aria-current=page], .wp-recent[aria-current=page]');
  });
});
