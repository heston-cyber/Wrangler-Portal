// Phase 5f (glass), tests 5f.1, 5f.2 and 5f.5, read from the stylesheets and the shader themselves (the screenshots for
// 5f.3 and 5f.4 are taken in a browser; their results are in the Master Plan).
//   5f.1 no glass on content, no glass on glass
//   5f.2 the accessibility settings give solid glass and no motion
//   5f.5 no black lines: the shader never normalises a zero vector (Apple's GPUs turn that into NaN, drawn black)
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FLOAT, GLASS } from "../src/lib/glass";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const [styles, d1, portal, states, type, glassSrc] = ["src/styles.css", "src/d1.css", "src/portal.css", "src/states.css", "src/type.css", "src/lib/glass.ts"].map(read);

type Rule = { sel: string[]; body: string; media: string };
/** A small CSS reader: every rule with its selectors and the @media it sits in. */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const walk = (s: string, media: string) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf("{", i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < s.length && depth) { if (s[j] === "{") depth++; else if (s[j] === "}") depth--; j++; }
      const inner = s.slice(open + 1, j - 1);
      if (head.startsWith("@media") || head.startsWith("@supports")) walk(inner, `${media} ${head}`.trim());
      else if (!head.startsWith("@")) out.push({ sel: splitSel(head), body: inner, media });
      i = j;
    }
  };
  walk(src, "");
  return out;
}
function splitSel(head: string) {
  const parts: string[] = []; let depth = 0, cur = "";
  for (const ch of head) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
const ALL = [styles, d1, portal, states, type].flatMap(rules);
const decl = (body: string, prop: string) => [...body.matchAll(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`, "g"))].map((m) => m[1].trim());
const accessible = (m: string) => /prefers-reduced-transparency|prefers-contrast/.test(m);

// the content layer: cards, stat tiles, lists, section cards (Foundations › 1 · Two layers)
const CONTENT = [".glass", ".pov-stat", ".wp-morelist", ".panel", ".note", ".vcard", ".rect", ".regwrap", ".nextrender", ".ws-card", ".ws-hubcard", ".wst-card", ".wst-clause", ".ws-sigform", ".ws-sigcard", ".wsx-card", ".ws-note", ".drop", ".wp-setmenu"];
const FLOATING = FLOAT.split(",").map((s) => s.trim());
const SURFACES = [".wp-side", ".wp-tabbar", ".wp-layerchip", ".menu", ".dialog", ".bell-panel", ".toast", ".cal-pop", ".selbar"];

describe("5f.1 no glass on content, no glass on glass", () => {
  test("the floating layer is exactly the surfaces the frames make glass", () => {
    expect(FLOATING).toEqual([...SURFACES.slice(0, 1), ".wp-shell:not(.overlay) .main > .topbar", ...SURFACES.slice(1)]);
  });

  test("every floating surface gets its frost, fill and 1 px edge from the CSS (the WebGL rim reads --lg-frost)", () => {
    for (const s of FLOATING) {
      const own = ALL.filter((r) => r.sel.includes(s) && !accessible(r.media));
      expect(own.some((r) => decl(r.body, "--lg-frost").length), `${s} has --lg-frost`).toBe(true);
      expect(own.some((r) => decl(r.body, "backdrop-filter").some((v) => /blur/.test(v))), `${s} is frosted`).toBe(true);
      expect(ALL.some((r) => r.sel.includes(`${s}::before`) && /var\(--glass-edge\)/.test(r.body)), `${s} has the glass edge`).toBe(true);
    }
    // Glass/effect is 12, Glass/effect-clear is 3: the tab bar, chips, toasts and small controls
    const clear = ALL.find((r) => r.sel.includes(".wp-tabbar") && decl(r.body, "--lg-frost")[0] === "3");
    expect(clear?.sel).toEqual([".wp-tabbar", ".wp-layerchip", ".toast", ".selbar"]);
    expect(GLASS.frost).toBe(12);
    expect(GLASS.frostClear).toBe(3);
  });

  test("content is never glass: no blur, no glass fill on a card, a tile, a list or a section card", () => {
    const bad: string[] = [];
    for (const r of ALL) {
      if (accessible(r.media)) continue;
      for (const sel of r.sel) {
        // a rule aimed at a content surface itself (its last compound), not at something inside it
        const last = sel.split(/[\s>+~]+/).pop() ?? "";
        if (!CONTENT.some((c) => new RegExp(`${c.replace(".", "\\.")}(?![\\w-])`).test(last))) continue;
        if (FLOATING.some((f) => last.includes(f))) continue;
        const blur = decl(r.body, "backdrop-filter").concat(decl(r.body, "-webkit-backdrop-filter")).filter((v) => v !== "none" && v !== "none !important");
        const glassFill = /var\(--glass-fill\)/.test(r.body);
        if (blur.length || glassFill) bad.push(`${sel} { ${blur.join(" ")}${glassFill ? " glass-fill" : ""} }`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the content card is Card/fill 78 %, Card/edge paper 14 % and Card/shadow 0 / 10 / 30 ink 45 %", () => {
    const root = ALL.find((r) => r.sel.includes(":root") && /--card-fill/.test(r.body))!;
    expect(decl(root.body, "--card-fill")[0]).toBe("color-mix(in srgb, var(--surface-base) 78%, transparent)");
    expect(decl(root.body, "--card-edge")[0]).toBe("rgba(var(--paper), .14)");
    expect(decl(root.body, "--card-shadow")[0]).toBe("0 10px 30px rgba(var(--ink), .45)");
    const card = ALL.filter((r) => r.sel.includes(".glass") && r.sel.length === 1 && !r.media).pop()!;
    expect(card.body).toMatch(/background: var\(--card-fill\)/);
    expect(card.body).not.toMatch(/backdrop-filter/);
  });

  test("never glass on glass: a floating surface inside another is drawn solid, and the WebGL skips it", () => {
    const nested = ALL.find((r) => r.sel.some((s) => /^:is\(\.wp-side.*\) :is\(/.test(s)));
    expect(nested?.body).toMatch(/background: var\(--glass-solid\)/);
    expect(nested?.body).toMatch(/backdrop-filter: none/);
    expect(glassSrc).toMatch(/!el\.parentElement\?\.closest\(FLOAT\)/);
  });
});

describe("5f.2 the accessibility settings give solid glass and no motion", () => {
  const block = ALL.filter((r) => /prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)|prefers-reduced-transparency: reduce\) , \(prefers-contrast/.test(r.media) || /\(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)/.test(r.media));
  test("Reduce transparency and Increase contrast: every glass surface and card is opaque, no blur, no effect", () => {
    const solid = block.find((r) => /var\(--glass-solid\) !important/.test(r.body));
    expect(solid, "the solid rule").toBeTruthy();
    for (const s of [...SURFACES, ...CONTENT.filter((c) => c !== ".wp-setmenu")]) expect(solid!.sel.some((x) => x === s || x.endsWith(` ${s}`) || x.endsWith(`> ${s}`)), s).toBe(true);
    expect(solid!.body).toMatch(/backdrop-filter: none !important/);
    expect(solid!.body).toMatch(/inset 0 0 0 1px var\(--glass-solid-edge\) !important/);
    expect(block.some((r) => r.sel.includes("canvas.wp-glass") && /display: none !important/.test(r.body))).toBe(true);
    // and the WebGL rim never starts (or stops) under either setting
    expect(glassSrc).toMatch(/matchMedia\("\(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\)"\)/);
  });
  test("Increase contrast: a 2 px Glass/contrast-edge (paper 55 %)", () => {
    const hc = ALL.find((r) => r.media === "@media (prefers-contrast: more)" && /--glass-contrast-edge/.test(r.body));
    expect(hc?.body).toMatch(/inset 0 0 0 2px var\(--glass-contrast-edge\) !important/);
    const root = ALL.find((r) => r.sel.includes(":root") && /--glass-contrast-edge/.test(r.body))!;
    expect(decl(root.body, "--glass-contrast-edge")[0]).toBe("rgba(var(--paper), .55)");
    expect(decl(root.body, "--glass-solid")[0]).toBe("#0b0b0d");
  });
  test("Reduce motion: nothing fades in", () => {
    const rm = ALL.find((r) => /prefers-reduced-motion: reduce/.test(r.media) && /\.topbar \.crumbs/.test(r.sel.join(",")));
    expect(rm?.body).toMatch(/transition: none !important/);
  });
});

describe("5f.5 no black lines", () => {
  test("the shader takes the edge's direction only where its slope is real, and leaves the middle to the CSS", () => {
    expect(glassSrc).not.toMatch(/normalize\(g/);
    expect(glassSrc).toMatch(/vec2 n = gl2 > 1e-4 \? g \* inversesqrt\(gl2\) : vec2\(0\.0\);/);
    expect(glassSrc).toMatch(/if \(x >= 0\.999\) discard;/);
    // nothing else divides by a value that can reach zero
    expect(glassSrc).toMatch(/pow\(max\(sq, 1e-4\), -0\.75\)/);
    expect(glassSrc).toMatch(/max\(-ray\.z, 0\.25\)/);
  });
});
