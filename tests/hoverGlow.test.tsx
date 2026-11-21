// @vitest-environment jsdom
// Nov 21 (Heston, approved 11:05): the gliding hover highlight, and right-click on everything on the Dashboard.
//   G1 only clickable things get the highlight: buttons, links, rows, tabs, menu items; not text fields, not plain text,
//      not disabled buttons, not something that only looks like a button, not anything marked data-no-glow
//   G2 the highlight is mounted once for the whole site, glides (with Reduce Motion it only fades), and never shows on
//      a touch screen
//   D1 every kind of Dashboard item opens a menu: Needs you rows (with Remind and Cancel signing on a contract, Start
//      the contract on an accepted proposal), clients (Rename, Add a person), activity rows and the tiles
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clickableAt } from "../src/ui/HoverGlow";

const box = (el: Element, w = 120, h = 36) => { (el as HTMLElement).getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }); return el; };
const make = (html: string) => { document.body.innerHTML = html; document.querySelectorAll("*").forEach((e) => box(e)); return (sel: string) => document.querySelector(sel)!; };

describe("the hover highlight", () => {
  it("G1 lights up clickable things only", () => {
    const q = make(`
      <button id="b"><span id="inner">Save</span></button>
      <a id="a" href="/x">Open</a>
      <a id="nohref">Not a link</a>
      <div id="tab" role="tab">Tab</div>
      <div id="mi" role="menuitem">Item</div>
      <button id="off" disabled>Off</button>
      <input id="text" />
      <textarea id="area"></textarea>
      <div id="looks" class="btn">Looks like a button</div>
      <p id="p">Plain words</p>
      <button id="skip" data-no-glow>Skip</button>
      <label><input id="check" type="checkbox" /></label>`);
    const at = (s: string) => clickableAt(q(s))?.id ?? null;
    expect(at("#b")).toBe("b");
    expect(at("#inner")).toBe("b"); // anywhere inside it
    expect(at("#a")).toBe("a");
    expect(at("#tab")).toBe("tab");
    expect(at("#mi")).toBe("mi");
    expect(at("#check")).toBe("check");
    for (const s of ["#nohref", "#off", "#text", "#area", "#looks", "#p", "#skip"]) expect(at(s), s).toBeNull();
  });
  it("G1b a whole card that's one big link isn't boxed (more than half the screen)", () => {
    const q = make(`<a id="big" href="/x">Huge</a>`);
    box(q("#big"), 1200, 700);
    expect(clickableAt(q("#big"), { w: 1280, h: 800 })).toBeNull();
  });
  it("G2 one highlight for the whole site: mouse only, glides, fades only with Reduce Motion", () => {
    expect(readFileSync("src/main.tsx", "utf8")).toContain("<HoverGlow />");
    const src = readFileSync("src/ui/HoverGlow.tsx", "utf8");
    expect(src).toContain('matchMedia?.("(hover: hover) and (pointer: fine)")');
    expect(src).toContain('e.pointerType !== "mouse" && e.pointerType !== "pen"');
    const css = readFileSync("src/portal.css", "utf8");
    expect(css).toMatch(/\.wp-hoverglow \{[^}]*transition: transform 160ms/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce) { .wp-hoverglow { transition: opacity 80ms linear; } }");
    expect(css).toContain("@media (hover: none), (pointer: coarse) { .wp-hoverglow { display: none; } }");
    expect(css).toMatch(/\.wp-hoverglow \{[^}]*pointer-events: none/);
  });
});

describe("right-click on the Dashboard", () => {
  const home = readFileSync("src/modules/home/OwnerHome.tsx", "utf8");
  it("D1 Needs you rows, clients, activity rows and tiles all open a menu, with their own actions", () => {
    const need = home.slice(home.indexOf("function NeedRow("), home.indexOf("/** Phase 5b step 5 (D143): a shoot someone moved"));
    expect(need.match(/<ListRow (?!menu=\{menu\})/g)).toBeNull(); // every row in NeedRow carries the menu
    expect(need).toContain('{ key: "remind", label: "Remind"');
    expect(need).toMatch(/key: "cancel", label: "Cancel signing…", danger: true[\s\S]{0,200}form: \{ title:/); // asks first
    expect(need).toContain('label: "Start the contract"');
    expect(home).toContain('{ key: "rename", label: "Rename…"');
    expect(home).toContain('{ key: "person", label: "Add a person…"');
    expect(readFileSync("src/ui/wp.tsx", "utf8")).toContain("<a {...linkProps(to)} {...hold} className={cls}"); // activity rows (InboxItem)
    expect(readFileSync("src/modules/overviews/Tile.tsx", "utf8")).toContain('<div className="pov-stat prod-tile" {...hold}>');
  });
});
