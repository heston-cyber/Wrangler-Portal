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

export const GLASS = { frost: 12, frostClear: 3, refraction: 1, depth: 70, dispersion: 0.85, lightAngle: -45, lightIntensity: 0.5 } as const;

/** The floating layer: every surface drawn as glass (portal.css gives the same list its CSS glass). */
export const FLOAT = ".wp-side, .wp-shell:not(.overlay) .main > .topbar, .wp-tabbar, .wp-layerchip, .menu, .dialog, .bell-panel, .toast, .cal-pop, .selbar";
const NEAR = 120; // surfaces this far off screen give their canvas back

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
uniform float u_texScale;// texture px per device px
uniform float u_light;
uniform vec2 u_ldir;
uniform float u_dpr;
uniform float u_ink;     // the ink in the surface's fill (0.34; sheets 0.78 / 0.92)
uniform float u_veil;    // how much the page dims the scene behind the surface
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
  float b = min(u_depth, 0.32 * min(u_size.x, u_size.y));     // bevel width
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
  float cap = 0.6 * b, m = length(bendv);
  bendv /= 1.0 + m / cap;
  float lod = log2(max(1.0, u_frost * u_texScale)) - 0.6;
  vec3 col = vec3(0.0);
  float k = u_disp * 0.08;                                     // red bends a little less, blue a little more
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + 0.4;
    vec2 q = px + vec2(cos(a), sin(a)) * u_frost * 0.45;
    col += vec3(scene(q + bendv * (1.0 - k), lod).r, scene(q + bendv, lod).g, scene(q + bendv * (1.0 + k), lod).b);
  }
  col /= 6.0;
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

type Shape = { el: HTMLElement; cv: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null; radius: number; frost: number; ink: number; veil: number; last: string; size: string };

/** A surface's glass settings, from its CSS; null when the CSS doesn't make it glass here (a phone's page title row). */
export function glassOf(el: Element): { frost: number; ink: number; veil: number } | null {
  const cs = getComputedStyle(el);
  const frost = parseFloat(cs.getPropertyValue("--lg-frost"));
  if (!Number.isFinite(frost)) return null;
  const num = (name: string, d: number) => { const v = parseFloat(cs.getPropertyValue(name)); return Number.isFinite(v) ? v : d; };
  return { frost, ink: num("--lg-ink", 0.34), veil: num("--lg-veil", 0) };
}

export function startGlass(host: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  // the accessible looks are solid, with no glass effect (Foundations, 5 · Accessible looks)
  if (matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more)").matches) return () => {};
  // A check for Heston's phone (Nov 6, the black lines): ?glass=css shows the plain CSS glass for this tab, ?glass=gl
  // brings the WebGL rim back.
  try {
    const q = new URLSearchParams(location.search).get("glass");
    if (q === "css" || q === "gl") sessionStorage.setItem("wp.glass", q);
    if (sessionStorage.getItem("wp.glass") === "css") return () => {};
  } catch { /* no storage: the glass as usual */ }
  // only the cactus scene (another business keeps its own light and the CSS glass)
  if (!/cactus/.test(getComputedStyle(host).backgroundImage)) return () => {};
  const glc = document.createElement("canvas");
  const gl = glc.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return () => {};
  const prog = program(gl);
  if (!prog) return () => {};

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(prog);
  const U = (name: string) => gl.getUniformLocation(prog, name);
  const u = { top: U("u_top"), img: U("u_img"), size: U("u_size"), r: U("u_r"), depth: U("u_depth"), refr: U("u_refr"), disp: U("u_disp"), frost: U("u_frost"), texScale: U("u_texScale"), light: U("u_light"), ldir: U("u_ldir"), dpr: U("u_dpr"), tex: U("u_tex"), ink: U("u_ink"), veil: U("u_veil") };
  const ang = (GLASS.lightAngle * Math.PI) / 180; // −45°: from the top left (screen y points down)
  gl.uniform2f(u.ldir, Math.cos(ang), Math.sin(ang));
  gl.uniform1f(u.refr, GLASS.refraction);
  gl.uniform1f(u.disp, GLASS.dispersion);
  gl.uniform1f(u.light, GLASS.lightIntensity);
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
  const release = (s: Shape) => { s.cv?.remove(); s.cv = null; s.ctx = null; s.last = ""; s.size = ""; };
  const collect = () => {
    if (!img) return;
    const next: Shape[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(FLOAT)) {
      const look = el.getClientRects().length > 0 ? glassOf(el) : null;
      // never glass on glass: a surface inside another floating surface is drawn plain (portal.css makes it solid)
      const ok = !!look && !el.parentElement?.closest(FLOAT);
      const had = shapes.find((x) => x.el === el);
      if (ok) {
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        const sh = had ?? { el, cv: null, ctx: null, radius, frost: 0, ink: 0, veil: 0, last: "", size: "" };
        if (sh.radius !== radius || sh.frost !== look!.frost || sh.ink !== look!.ink || sh.veil !== look!.veil) Object.assign(sh, { radius, ...look!, last: "" });
        el.dataset.gl = "1";
        next.push(sh);
      } else if (el.dataset.gl) delete el.dataset.gl;
    }
    for (const s of shapes) if (!next.includes(s)) { release(s); if (s.el.isConnected) delete s.el.dataset.gl; }
    shapes = next;
    ro.disconnect();
    for (const s of shapes) ro.observe(s.el);
  };

  // ---------- drawing ----------
  const draw = () => {
    raf = 0;
    if (!img || !tex || dead) return;
    if (img.phone !== phone()) load(phone());
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const box = host.getBoundingClientRect();
    const W = box.width * dpr, H = box.height * dpr;
    // the scene as the CSS draws it: cover; centred (phone: anchored to the bottom)
    const sc = Math.max(W / img.w, H / img.h), dw = img.w * sc, dh = img.h * sc;
    const dx = (W - dw) / 2, dy = img.phone ? H - dh : (H - dh) / 2;
    const sceneKey = `${W}|${H}|${box.left}|${box.top}`;
    if (sceneKey !== scene) { scene = sceneKey; for (const s of shapes) s.last = ""; }
    gl.uniform1f(u.texScale, img.w / dw);
    gl.uniform1f(u.depth, GLASS.depth * dpr);
    gl.uniform1f(u.dpr, dpr);
    let pending = false;
    for (const s of shapes) {
      const r = s.el.getBoundingClientRect();
      const near = r.bottom > -NEAR && r.top < innerHeight + NEAR && r.right > -NEAR && r.left < innerWidth + NEAR && r.width >= 2 && r.height >= 2;
      if (!near) { if (s.cv) release(s); continue; }
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      const key = `${r.left.toFixed(1)}|${r.top.toFixed(1)}|${w}|${h}`, size = `${w}|${h}`;
      if (s.cv && key === s.last) continue; // hasn't moved: its glass is still right
      // Nov 11 (5f.3): a surface carried along by the page's scroll (the phone's chips), or sliding in, only slides over
      // the scene, which its veil and frost all but hide; it's redrawn where it stops, not on every frame it slides
      // (redrawing ten chips a frame dropped a phone-sized software GPU to 26 fps; this keeps it at 60).
      if (s.cv && size === s.size && performance.now() < movingUntil) { pending = true; continue; }
      s.last = key; s.size = size;
      if (!s.cv) {
        s.cv = document.createElement("canvas");
        s.cv.className = "wp-glass";
        s.cv.setAttribute("aria-hidden", "true");
        s.el.prepend(s.cv);
        s.ctx = s.cv.getContext("2d");
      }
      if (s.cv.width !== w || s.cv.height !== h) { s.cv.width = w; s.cv.height = h; }
      if (glc.width < w || glc.height < h) { glc.width = Math.max(glc.width, w); glc.height = Math.max(glc.height, h); }
      gl.viewport(0, glc.height - h, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, glc.height - h, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.SCISSOR_TEST);
      gl.uniform1f(u.top, glc.height);
      gl.uniform2f(u.size, w, h);
      gl.uniform1f(u.r, s.radius * dpr);
      gl.uniform1f(u.frost, s.frost * dpr);
      gl.uniform1f(u.ink, s.ink);
      gl.uniform1f(u.veil, s.veil);
      gl.uniform4f(u.img, dx - (r.left - box.left) * dpr, dy - (r.top - box.top) * dpr, dw, dh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      s.ctx?.clearRect(0, 0, w, h);
      s.ctx?.drawImage(glc, 0, 0, w, h, 0, 0, w, h);
    }
    // keep looking every frame while anything may be moving (a sheet sliding in, momentum scrolling the chips)
    if (pending || performance.now() < movingUntil) raf = requestAnimationFrame(draw);
  };
  const kick = (ms = 0) => { movingUntil = Math.max(movingUntil, performance.now() + ms); if (!raf) raf = requestAnimationFrame(draw); };
  const onScroll = () => kick(250);
  const onMove = () => kick(700);
  let recollect = 0;
  const changed = () => { if (!recollect) recollect = requestAnimationFrame(() => { recollect = 0; collect(); kick(); }); };

  const ro = new ResizeObserver(() => kick());
  const mo = new MutationObserver((list) => { if (list.some((m) => !(m.target instanceof HTMLCanvasElement) && ![...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLCanvasElement))) changed(); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "data-full"] });
  addEventListener("scroll", onScroll, { capture: true, passive: true });
  addEventListener("touchmove", onScroll, { passive: true });
  addEventListener("resize", changed);
  visualViewport?.addEventListener("resize", onScroll);
  addEventListener("transitionrun", onMove, true);
  addEventListener("animationstart", onMove, true);
  const mq = matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more)");
  const onLook = () => { if (mq.matches) stop(); };
  mq.addEventListener?.("change", onLook);
  glc.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); });

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
