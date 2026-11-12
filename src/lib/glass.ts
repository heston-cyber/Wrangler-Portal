// The glass, Phase 5f (Design Log "Handoff ready: Phase 5f (glass)", approved Nov 11; D164). Apple's Liquid Glass rules:
// glass only on the floating layer (sidebar, top bar, phone tab bar and chips, menus, popovers, dialogs, sheets, the bell
// panel, toasts); content cards are not glass (portal.css: the card surface). Never glass on glass.
//
// Each floating surface is drawn in two parts:
//  - the middle, by CSS: the frost (backdrop blur, Glass/effect 12, Glass/effect-clear 3) and Figma's fill and edge,
//    so whatever really sits behind it (cards, text, the scene) shows through, frosted;
//  - the rim, by WebGL: a narrow squircle bevel bends the scene inward (refraction 1, depth 70 caps the bevel), splits it
//    into red and blue (dispersion 0.85) and catches the light from the top left (−45°, 0.5). Browsers can't bend what's
//    behind a box with CSS (Safari, and so every iPhone browser, has no backdrop SVG filters), but the scene is one known
//    picture, fixed to the window, so WebGL can. The rim fades into the CSS middle.
// The floating layer hardly moves, so a surface is redrawn only when it moves or changes size (scrolling the page costs
// nothing; Nov 11, the cost Heston saw). No grain on the glass (Heston, Nov 6; Figma's 8 % noise is left out).
// Each surface can set, in CSS: --lg-frost (12 or 3), --lg-ink (the ink in its fill: 0.34, a half sheet 0.78, a
// full-screen sheet 0.92) and --lg-veil (how much the page dims the scene behind it: the scroll fades, a dialog's scrim).
// Without WebGL, with Reduce transparency or Increase contrast on, or on another business's background, the CSS glass
// stands alone (D164: plain frost only where the bending glass can't be drawn).

// D169 (Heston, Nov 11: "too dark and frosted", "edges don't bend enough"): clearer and bending more than Figma's
// Glass/effect (frost 12, refraction 1, ink 34 %); the CSS frost matches (portal.css --blur-glass: 4 px, saturate 160 %,
// brightness 68 %; ink 16 %).
export const GLASS = { frost: 4, frostClear: 2, refraction: 1.5, depth: 70, bevel: 0.4, dispersion: 0.85, lightAngle: -45, lightIntensity: 0.5, saturate: 1.6, brightness: 0.68 } as const;

/** The floating layer: every surface drawn as glass (portal.css gives the same list its CSS glass). */
export const FLOAT = ".wp-side, .wp-shell:not(.overlay) .main > .topbar, .wp-tabbar, .wp-layerchip, .menu, .dialog, .bell-panel, .toast, .cal-pop, .selbar";
/** D168 (Heston, Nov 11: "The rectangles should be glass"): the cards and stat tiles are the same bending glass. */
export const CARDS = ".glass, .pov-stat";
const ALL = `${FLOAT}, ${CARDS}`;
const NEAR = 120; // surfaces this far off screen give their canvas back
const RES = 1.5;  // pixels per CSS pixel a still surface's rim is drawn at
const RES_FLOOR = 1;  // the least a moving card's rim drops to, and only if the device falls behind (Heston, Nov 11:
                      // "Still want to maintain quality")

const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_top;     // the drawing buffer's height (the surface is drawn in its top-left corner)
uniform vec4 u_img;      // where the scene sits, relative to the surface's top left: x, y, w, h (device px)
uniform vec2 u_size;     // the surface, device px
uniform float u_r;       // its corner radius
uniform float u_depth;   // how far in from the edge the glass bends
uniform float u_refr;
uniform float u_disp;
uniform float u_frost;   // frost radius, device px
uniform vec4 u_fade;     // a fade the page lays over the scene behind this surface: its top on screen relative to the
                         // surface (render px), its height (0: none), where its middle stop is (0–1), unused
uniform vec3 u_fadeA;    // the fade's ink at its top, its middle stop, its bottom
uniform float u_texScale;// texture px per device px
uniform float u_light;
uniform vec2 u_ldir;
uniform float u_dpr;
uniform float u_ink;     // the ink in the surface's fill (0.34; sheets 0.78 / 0.92)
uniform float u_veil;    // how much the page dims the scene behind the surface
uniform float u_sat;     // the frost's colour boost and dimming, as the CSS backdrop-filter
uniform float u_bright;
out vec4 o;

float sd(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec3 scene(vec2 px, float lod) { return textureLod(u_tex, (px - u_img.xy) / u_img.zw, lod).rgb; }

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_top - gl_FragCoord.y);   // surface-local, from its top left
  vec2 h = u_size * 0.5;
  vec2 p = px - h;
  float r = min(u_r, min(h.x, h.y));
  float d = sd(p, h, r);
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  // The rim (Nov 6, after Apple's Liquid Glass): a narrow convex squircle bevel (height (1-(1-x)^4)^(1/4)), flat in the
  // middle. A straight-down ray is bent by Snell's law (index 1.5) where the surface tilts, so near the rim it lands
  // *inward*: the rim shows what is behind the surface, squeezed and magnified, never what is beside it. The bevel's
  // normals come from a rounded box whose corners are at least as round as the bevel is wide, so they never fold.
  float b = min(u_depth, ${GLASS.bevel.toFixed(2)} * min(u_size.x, u_size.y)); // bevel width
  float R2 = min(max(r, b), min(h.x, h.y));
  float d2 = sd(p, h, R2);
  float x = clamp(-d2 / b, 0.0, 1.0);                         // 0 at the rim, 1 where the flat middle starts
  if (x >= 0.999) discard;                                    // the middle is the CSS frost's
  vec2 e = vec2(1.0, 0.0);
  // Nov 11 (Heston's iPhone: a black line across the middle): the slope's direction is taken only where it is real;
  // Apple's GPUs turn normalize(0) into NaN (black).
  vec2 g = vec2(sd(p + e.xy, h, R2) - sd(p - e.xy, h, R2), sd(p + e.yx, h, R2) - sd(p - e.yx, h, R2));
  float gl2 = dot(g, g);
  vec2 n = gl2 > 1e-4 ? g * inversesqrt(gl2) : vec2(0.0);
  float xm = max(x, 0.004), om = 1.0 - xm;
  float sq = 1.0 - om * om * om * om;
  float height = b * pow(sq, 0.25);
  float slope = om * om * om * pow(max(sq, 1e-4), -0.75);
  vec3 N = normalize(vec3(n * slope, 1.0));
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / 1.5);
  vec2 bendv = ray.xy / max(-ray.z, 0.25) * (height + 0.25 * b) * u_refr;
  float cap = 0.9 * b, m = length(bendv);
  bendv /= 1.0 + m / cap;
  // Nov 11 check: as blurry as the CSS frost's Gaussian (fitted against it: mip footprint 1.5×, taps at 0.9× the frost)
  // a little softer where the rim squeezes the scene hardest, so it doesn't shimmer as a card moves (Nov 11 pass)
  float lod = log2(max(1.0, u_frost * u_texScale * 1.5)) + log2(1.0 + 0.5 * min(slope, 4.0));
  vec3 col = vec3(0.0);
  float k = u_disp * 0.08;                                     // red bends a little less, blue a little more
  for (int i = 0; i < 3; i++) {                               // three taps: the light frost (D169) needs no more
    float a = float(i) * 2.0944 + 0.4;
    vec2 q = px + vec2(cos(a), sin(a)) * u_frost * 0.9;
    col += vec3(scene(q + bendv * (1.0 - k), lod).r, scene(q + bendv, lod).g, scene(q + bendv * (1.0 + k), lod).b);
  }
  col /= 3.0;
  // the page's fades lie between the scene and this surface (the phone's top scrim behind cards and chips, the desktop
  // scroll fade behind the top bar, the fade above the phone's tab bar), so the bent scene is seen through them too, as
  // the CSS middle sees it (Nov 11 check: without this a bright rim circled a dark middle)
  if (u_fade.y > 0.0) {
    float t = clamp((px.y + bendv.y - u_fade.x) / u_fade.y, 0.0, 1.0);
    float fa = t < u_fade.z ? mix(u_fadeA.x, u_fadeA.y, t / u_fade.z) : mix(u_fadeA.y, u_fadeA.z, (t - u_fade.z) / (1.0 - u_fade.z));
    col = mix(col, vec3(0.012, 0.004, 0.016), fa);
  }
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = clamp(mix(vec3(lum), col, u_sat), 0.0, 1.0) * u_bright; // as the CSS frost: saturate(160 %), clipped (as CSS clips
                                                               // between filters), then brightness(68 %)
  vec3 ink = vec3(0.012, 0.004, 0.016), paper = vec3(0.957, 0.945, 0.914);
  col = mix(col, ink, u_veil);                                 // what the page lays over the scene there
  col = mix(col, ink, u_ink);                                  // the surface's own fill (as the CSS middle)
  col = mix(col, paper, 0.02 + 0.02 * max(0.0, 1.0 - px.y / u_size.y));
  float w = pow(1.0 - x, 1.4);                                 // the bent rim fades into the frosted middle
  // light from the top left: a fine line on the rim where it faces the light, a fainter one opposite, a soft sheen
  float facing = dot(n, -u_ldir);
  float edge = exp(-max(-d, 0.0) / (1.1 * u_dpr));
  float rimEdge = 1.0 - x;
  float spec = u_light * (0.6 * edge * pow(max(facing, 0.0), 2.0) + 0.22 * edge * pow(max(-facing, 0.0), 2.0) + 0.07 * rimEdge * rimEdge * max(facing, 0.0));
  float a = clamp(max(w, spec), 0.0, 1.0) * alpha;
  vec3 c = col * w * alpha + vec3(spec) * alpha;               // premultiplied
  o = vec4(min(c, vec3(a)), a);
}`;

type Shape = { el: HTMLElement; cv: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null; br: ImageBitmapRenderingContext | null; radius: number; frost: number; ink: number; veil: number; lazy: boolean; last: string; size: string };

/** A surface's glass settings, from its CSS; null when the CSS doesn't make it glass here (a phone's page title row). */
export function glassOf(el: Element): { frost: number; ink: number; veil: number; lazy: boolean } | null {
  const cs = getComputedStyle(el);
  const frost = parseFloat(cs.getPropertyValue("--lg-frost"));
  if (!Number.isFinite(frost)) return null;
  const num = (name: string, d: number) => { const v = parseFloat(cs.getPropertyValue(name)); return Number.isFinite(v) ? v : d; };
  return { frost, ink: num("--lg-ink", 0.16), veil: num("--lg-veil", 0), lazy: num("--lg-lazy", 0) > 0 };
}

/** The rim band of a w × h surface as four strips (24 vertices, clip space), leaving out the flat middle the shader
 *  would discard anyway: inset by the bevel's width, or the corner radius where that's larger. */
export function rimStrips(w: number, h: number, radius: number, depth: number): Float32Array {
  const b = Math.min(depth, GLASS.bevel * Math.min(w, h));
  const R2 = Math.min(Math.max(radius, b), Math.min(w, h) / 2);
  const i = Math.ceil(Math.max(b, R2)) + 1;
  const out = new Float32Array(48);
  // one rect covering the whole surface when the middle is too small to leave out
  const rects: [number, number, number, number][] = 2 * i >= Math.min(w, h)
    ? [[0, 0, w, h], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
    : [[0, 0, w, i], [0, h - i, w, h], [0, i, i, h - i], [w - i, i, w, h - i]];
  let k = 0;
  for (const [x0, y0, x1, y1] of rects) {
    const X0 = (x0 / w) * 2 - 1, X1 = (x1 / w) * 2 - 1, Y0 = 1 - (y0 / h) * 2, Y1 = 1 - (y1 / h) * 2;
    for (const [x, y] of [[X0, Y0], [X1, Y0], [X0, Y1], [X0, Y1], [X1, Y0], [X1, Y1]]) { out[k++] = x; out[k++] = y; }
  }
  return out;
}

export function startGlass(host: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  // the accessible looks are solid, with no glass effect (Foundations, 5 · Accessible looks)
  if (matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more)").matches) return () => {};
  // Checks for Heston's phone: ?glass=css shows the plain CSS glass for this tab, ?glass=gl brings the WebGL rim back,
  // ?glass=lazy keeps the cards' rims still while they scroll and redraws them where they stop (with a quick fade).
  let lazyMode = false;
  try {
    const q = new URLSearchParams(location.search).get("glass");
    if (q === "css" || q === "gl" || q === "lazy") sessionStorage.setItem("wp.glass", q);
    if (sessionStorage.getItem("wp.glass") === "css") return () => {};
    lazyMode = sessionStorage.getItem("wp.glass") === "lazy";
  } catch { /* no storage: the glass as usual */ }
  // only the cactus scene (another business keeps its own light and the CSS glass)
  if (!/cactus/.test(getComputedStyle(host).backgroundImage)) return () => {};
  // Nov 11 pass: where the browser can (Safari 17+, Chrome), the glass is drawn in an OffscreenCanvas and each surface is
  // handed its picture (transferToImageBitmap → bitmaprenderer: no copy); otherwise it's copied from a hidden canvas.
  let off: OffscreenCanvas | null = null;
  let gl: WebGL2RenderingContext | null = null;
  try {
    const probe = document.createElement("canvas").getContext("bitmaprenderer");
    if (probe && typeof OffscreenCanvas !== "undefined") { off = new OffscreenCanvas(1, 1); gl = off.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true }) as WebGL2RenderingContext | null; }
  } catch { gl = null; }
  if (!gl) off = null;
  const glc = document.createElement("canvas");
  gl = gl ?? glc.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return () => {};
  const target: { width: number; height: number } = off ?? glc;
  const prog = program(gl);
  if (!prog) return () => {};

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(48), gl.DYNAMIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(prog);
  const U = (name: string) => gl.getUniformLocation(prog, name);
  const u = { top: U("u_top"), img: U("u_img"), size: U("u_size"), r: U("u_r"), depth: U("u_depth"), refr: U("u_refr"), disp: U("u_disp"), frost: U("u_frost"), texScale: U("u_texScale"), light: U("u_light"), ldir: U("u_ldir"), dpr: U("u_dpr"), tex: U("u_tex"), ink: U("u_ink"), veil: U("u_veil"), sat: U("u_sat"), bright: U("u_bright"), fade: U("u_fade"), fadeA: U("u_fadeA") };
  const ang = (GLASS.lightAngle * Math.PI) / 180; // −45°: from the top left (screen y points down)
  gl.uniform2f(u.ldir, Math.cos(ang), Math.sin(ang));
  // a check for the build (tests and screenshots set window.__glassCheck): no bend, no colour split, no light, so a rim
  // that doesn't vanish into the CSS middle is a mistake (a misplaced scene, a missing overlay, a different tint)
  const check = !!(window as unknown as { __glassCheck?: boolean }).__glassCheck;
  gl.uniform1f(u.refr, check ? 0 : GLASS.refraction);
  gl.uniform1f(u.disp, check ? 0 : GLASS.dispersion);
  gl.uniform1f(u.light, check ? 0 : GLASS.lightIntensity);
  gl.uniform1f(u.sat, GLASS.saturate);
  gl.uniform1f(u.bright, GLASS.brightness);
  gl.uniform1i(u.tex, 0);

  let tex: WebGLTexture | null = null;
  let img: { w: number; h: number; phone: boolean } | null = null;
  let shapes: Shape[] = [];
  let raf = 0, dead = false, movingUntil = 0, scene = "";

  const phone = () => innerWidth <= 820;
  const load = (isPhone: boolean) => {
    const name = isPhone ? "cactus-phone" : "cactus-desktop";
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      if (dead) return;
      tex = tex ?? gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      img = { w: im.naturalWidth, h: im.naturalHeight, phone: isPhone };
      scene = "";
      document.documentElement.dataset.glass = "gl";
      collect(); kick();
    };
    im.onerror = () => { if (im.src.endsWith(".webp")) im.src = `/bg/${name}.jpg`; };
    im.src = `/bg/${name}.webp`;
  };
  load(phone());

  // ---------- which surfaces to draw ----------
  const release = (s: Shape) => { s.cv?.remove(); s.cv = null; s.ctx = null; s.br = null; s.last = ""; s.size = ""; };
  const collect = () => {
    if (!img) return;
    const next: Shape[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(ALL)) {
      const look = el.getClientRects().length > 0 ? glassOf(el) : null;
      // never glass on glass: a surface inside another floating surface is drawn plain (portal.css makes it solid)
      const ok = !!look && !el.parentElement?.closest(ALL);
      const had = shapes.find((x) => x.el === el);
      if (ok) {
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        const sh = had ?? { el, cv: null, ctx: null, br: null, radius, frost: 0, ink: 0, veil: 0, lazy: false, last: "", size: "" };
        if (sh.radius !== radius || sh.frost !== look!.frost || sh.ink !== look!.ink || sh.veil !== look!.veil || sh.lazy !== look!.lazy) Object.assign(sh, { radius, ...look!, last: "" });
        el.dataset.gl = "1";
        next.push(sh);
      } else if (el.dataset.gl) delete el.dataset.gl;
    }
    for (const s of shapes) if (!next.includes(s)) { release(s); if (s.el.isConnected) delete s.el.dataset.gl; }
    shapes = next;
    ro.disconnect();
    for (const s of shapes) ro.observe(s.el);
  };

  // ---------- the page's fades behind a surface (portal.css "Phase 5f") ----------
  type Fade = { y0: number; h: number; m: number; a: [number, number, number] };
  const NONE: Fade = { y0: 0, h: 0, m: 0.5, a: [0, 0, 0] };
  const fadeFor = (el: HTMLElement): Fade => {
    const shell = el.closest(".wp-shell:not(.overlay)");
    if (!shell) return NONE;
    if (phone()) {
      // the tab bar: content fades above it (112 tall from 30 px above it: 0 → 60 % at 60 % → 92 %)
      if (el.classList.contains("wp-tabbar")) { const t = el.getBoundingClientRect().top - 30; return { y0: t, h: innerHeight - t, m: 0.6, a: [0, 0.6, 0.92] }; }
      // cards and chips sit over the top scrim (.wp-shell::before: 320 tall, 92 % → 60 % at 60 % → 0)
      if (el.closest(".main")) return { y0: 0, h: 320, m: 0.6, a: [0.92, 0.6, 0] };
      return NONE;
    }
    // the desktop top bar, once the page has scrolled under it (.main::before: 112 tall, 92 % → 55 % at 55 % → 0)
    const main = el.parentElement;
    if (el.classList.contains("topbar") && main?.dataset.scrolled) return { y0: main.getBoundingClientRect().top, h: 112, m: 0.55, a: [0.92, 0.55, 0] };
    return NONE;
  };

  // ---------- drawing ----------
  // Frame pacing while things move: if frames run long (over 20 ms on average across 20 frames), moving cards' rims step
  // down a quarter of a pixel per CSS pixel (not below RES_FLOOR); when frames are quick again they step back up.
  let slideRes = RES, lastFrame = 0, paced: number[] = [];
  const slowTest = !!(window as unknown as { __glassSlow?: boolean }).__glassSlow; // the build's check: every frame counts as slow
  const pace = (now: number) => {
    if (lastFrame && performance.now() < movingUntil) paced.push(slowTest ? 40 : now - lastFrame); // lastFrame is 0 after a pause
    lastFrame = now;
    if (paced.length >= (slowTest ? 4 : 20)) {
      const avg = paced.reduce((a, b) => a + b, 0) / paced.length;
      if (avg > 20 && slideRes > RES_FLOOR) slideRes = Math.max(RES_FLOOR, slideRes - 0.25);
      else if (avg < 17.5 && slideRes < RES) slideRes = Math.min(RES, slideRes + 0.25);
      paced = [];
    }
  };
  const draw = (now: number) => {
    pace(now);
    const t0 = performance.now();
    drawn = 0;
    paint();
    meter?.(performance.now() - t0, drawn, slideRes);
  };
  let drawn = 0;
  // ?glassmeter=1 (Nov 11, for Heston's iPhone): a small box with the frame rate while scrolling and the glass's share
  // of each frame, so a real phone can report its own numbers. ?glassmeter=0 hides it.
  let meter: ((ms: number, n: number, res: number) => void) | null = null;
  try {
    const m = new URLSearchParams(location.search).get("glassmeter");
    if (m === "1" || m === "0") sessionStorage.setItem("wp.glassmeter", m);
    if (sessionStorage.getItem("wp.glassmeter") === "1") {
      const box = document.createElement("div");
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = "position:fixed;z-index:9999;left:8px;top:calc(env(safe-area-inset-top,0px) + 8px);padding:6px 8px;border-radius:8px;background:rgba(0,0,0,.75);color:#fff;font:600 11px/1.3 ui-monospace,monospace;pointer-events:none;white-space:pre";
      document.body.appendChild(box);
      let frames: number[] = [], glassMs = 0, glassN = 0, surfaces = 0, res = RES, last = performance.now(), shownAt = 0;
      const tick = (now: number) => {
        if (dead) { box.remove(); return; }
        frames.push(now - last); last = now;
        if (now - shownAt > 500) {
          const busy = frames.filter((f) => f < 200);
          const avg = busy.reduce((a, b) => a + b, 0) / Math.max(1, busy.length);
          const slow = busy.filter((f) => f > 20).length;
          box.textContent = `${Math.round(1000 / Math.max(avg, 1))} fps · ${avg.toFixed(1)} ms/frame\nslow frames ${slow}/${busy.length}\nglass ${glassN ? (glassMs / glassN).toFixed(2) : "0"} ms · ${surfaces} redrawn\nquality ${Math.round((res / RES) * 100)} %`;
          frames = []; glassMs = 0; glassN = 0; surfaces = 0; shownAt = now;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      meter = (ms, n, r) => { res = r; if (n) { glassMs += ms; glassN++; surfaces = Math.max(surfaces, n); } };
    }
  } catch { /* no storage: no meter */ }
  const paint = () => {
    raf = 0;
    if (!img || !tex || dead) return;
    if (img.phone !== phone()) load(phone());
    // D168 (5f.3): the rim is a soft, bent picture, so it's drawn at up to 1.5 pixels per CSS pixel and stretched to
    // the surface (a phone's 3× would cost four times as much for nothing you can see); the crisp edge is the CSS line.
    // Nov 11 (Heston: "when I press to scroll the effect goes away"): cards and chips that scroll with the page are drawn
    // at 1 pixel per CSS pixel (their rim is soft), so redrawing them on every frame they move stays cheap.
    const box = host.getBoundingClientRect();
    const sceneKey = `${box.width}|${box.height}|${box.left}|${box.top}|${devicePixelRatio}`;
    if (sceneKey !== scene) { scene = sceneKey; for (const s of shapes) s.last = ""; }
    let at = -1;
    const useRes = (res: number) => {
      if (res === at) return;
      at = res;
      const W = box.width * res, H = box.height * res;
      // the scene as the CSS draws it: cover; centred (phone: anchored to the bottom)
      const sc = Math.max(W / img!.w, H / img!.h), dw = img!.w * sc, dh = img!.h * sc;
      view = { dx: (W - dw) / 2, dy: img!.phone ? H - dh : (H - dh) / 2, dw, dh };
      gl.uniform1f(u.texScale, img!.w / dw);
      gl.uniform1f(u.depth, GLASS.depth * res);
      gl.uniform1f(u.dpr, res);
    };
    let view = { dx: 0, dy: 0, dw: 1, dh: 1 };
    let pending = false;
    const moving = performance.now() < movingUntil;
    for (const s of shapes) {
      // quality first: full resolution, still or moving; a moving card's rim steps down only while the device can't keep
      // up, and is redrawn at full resolution where it stops
      const dpr = Math.min(devicePixelRatio || 1, s.lazy && moving ? slideRes : RES);
      if (dpr < Math.min(devicePixelRatio || 1, RES)) pending = true;
      const r = s.el.getBoundingClientRect();
      const near = r.bottom > -NEAR && r.top < innerHeight + NEAR && r.right > -NEAR && r.left < innerWidth + NEAR && r.width >= 2 && r.height >= 2;
      const sliding = s.lazy && lazyMode && performance.now() < movingUntil;
      if (!near) { if (s.cv && !sliding) release(s); continue; }
      // just off screen: keep its canvas but don't draw it until it comes into view (Nov 11 pass)
      if (s.cv && (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth)) { s.last = ""; continue; }
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      const f = fadeFor(s.el);
      const key = `${r.left.toFixed(1)}|${r.top.toFixed(1)}|${w}|${h}|${f.y0.toFixed(1)}|${f.h}`, size = `${w}|${h}`;
      if (s.cv && key === s.last) continue; // hasn't moved: its glass is still right
      // ?glass=lazy only (the Nov 11 first try; Heston: "when I press to scroll the effect goes away"): surfaces that
      // slide with the page (--lg-lazy) are redrawn where they stop; while they slide their rim steps aside (a quick fade,
      // portal.css canvas.wp-glass.stale). By default they're redrawn on every frame, so the bend stays as they scroll.
      if (sliding && (!s.cv || size === s.size)) { if (s.cv && !s.cv.classList.contains("stale")) s.cv.classList.add("stale"); pending = true; continue; }
      s.last = key; s.size = size;
      if (!s.cv) {
        s.cv = document.createElement("canvas");
        s.cv.className = "wp-glass";
        s.cv.setAttribute("aria-hidden", "true");
        s.el.prepend(s.cv);
        if (off) s.br = s.cv.getContext("bitmaprenderer"); else s.ctx = s.cv.getContext("2d");
      }
      if (s.cv.width !== w || s.cv.height !== h) { s.cv.width = w; s.cv.height = h; }
      if (off) { if (off.width !== w || off.height !== h) { off.width = w; off.height = h; } }
      else if (glc.width < w || glc.height < h) { glc.width = Math.max(glc.width, w); glc.height = Math.max(glc.height, h); }
      gl.viewport(0, target.height - h, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, target.height - h, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      gl.uniform1f(u.top, target.height);
      gl.uniform2f(u.size, w, h);
      gl.uniform1f(u.r, s.radius * dpr);
      gl.uniform1f(u.frost, s.frost * dpr);
      gl.uniform1f(u.ink, s.ink);
      gl.uniform1f(u.veil, s.veil);
      useRes(dpr);
      gl.uniform4f(u.fade, (f.y0 - r.top) * dpr, f.h * dpr, f.m, 0);
      gl.uniform3f(u.fadeA, f.a[0], f.a[1], f.a[2]);
      gl.uniform4f(u.img, view.dx - (r.left - box.left) * dpr, view.dy - (r.top - box.top) * dpr, view.dw, view.dh);
      // Nov 11 pass: only the rim band is drawn (four strips round the flat middle, which the CSS frost covers)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, rimStrips(w, h, s.radius * dpr, GLASS.depth * dpr));
      gl.drawArrays(gl.TRIANGLES, 0, 24);
      drawn++;
      if (off && s.br) s.br.transferFromImageBitmap(off.transferToImageBitmap()); // handed over, no copy
      else if (s.ctx) { s.ctx.globalCompositeOperation = "copy"; s.ctx.drawImage(glc, 0, 0, w, h, 0, 0, w, h); } // replaces, no clear pass
      s.cv.classList.remove("stale");
    }
    // keep looking every frame while anything may be moving (a sheet sliding in, momentum scrolling the chips)
    if (pending || performance.now() < movingUntil) raf = requestAnimationFrame(draw);
    else lastFrame = 0; // the loop rests: the next frame starts a new run of frame timings
  };
  const kick = (ms = 0) => { movingUntil = Math.max(movingUntil, performance.now() + ms); if (!raf) raf = requestAnimationFrame(draw); };
  const onScroll = () => kick(250);
  const onMove = () => kick(700);
  let recollect = 0;
  const changed = () => { if (!recollect) recollect = requestAnimationFrame(() => { recollect = 0; collect(); kick(); }); };

  const ro = new ResizeObserver(() => kick());
  const mo = new MutationObserver((list) => { if (list.some((m) => !(m.target instanceof HTMLCanvasElement) && ![...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLCanvasElement))) changed(); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-full", "data-scrolled"] });
  addEventListener("scroll", onScroll, { capture: true, passive: true });
  addEventListener("touchmove", onScroll, { passive: true });
  addEventListener("resize", changed);
  visualViewport?.addEventListener("resize", onScroll);
  addEventListener("transitionrun", onMove, true);
  addEventListener("animationstart", onMove, true);
  const mq = matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more)");
  const onLook = () => { if (mq.matches) stop(); };
  mq.addEventListener?.("change", onLook);
  (off ?? glc).addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); });

  function stop() {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf); cancelAnimationFrame(recollect);
    ro.disconnect(); mo.disconnect();
    removeEventListener("scroll", onScroll, { capture: true });
    removeEventListener("touchmove", onScroll);
    removeEventListener("resize", changed);
    visualViewport?.removeEventListener("resize", onScroll);
    removeEventListener("transitionrun", onMove, true);
    removeEventListener("animationstart", onMove, true);
    mq.removeEventListener?.("change", onLook);
    for (const s of shapes) { release(s); delete s.el.dataset.gl; }
    delete document.documentElement.dataset.glass;
  }
  return stop;
}

function program(gl: WebGL2RenderingContext) {
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : (console.warn(gl.getShaderInfoLog(s)), null); };
  const v = sh(gl.VERTEX_SHADER, VERT), f = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}
