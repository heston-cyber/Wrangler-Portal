// The glass (Heston, Nov 5, 19:57 and 22:03): every card is one glass, Figma's "Glass/effect" style, rendered the way
// Apple's Liquid Glass works (Nov 6): the scene behind it bends inward through a narrow curved rim (refraction 100 %,
// depth 70 caps the rim's width), splits into red and blue at the rim (dispersion 85 %), is
// lightly frosted (12) and lit from the top left (−45°, 50 %), with a fine grain (Figma's 8 %, softened to 5 % because a
// screen shows it at every device pixel). Browsers can't bend what's behind a box with CSS (Safari, and so every iPhone
// browser, has no backdrop SVG filters), but the scene is one known picture, so WebGL draws it.
//
// Nov 6 (Heston: "the animation isn't smooth"): each card now carries its own small canvas, inside the card, so the
// glass's shape, rim and tint scroll with the card on the browser's own scrolling (one canvas fixed behind the page
// trailed the cards by a frame while scrolling). One WebGL context draws each card in turn and copies it into the
// card's canvas, every frame while anything moves. Cards it draws (data-gl) lose their CSS blur and fill: the shader
// lays Figma's fill layers on top. Anything floating over other cards (dialogs, menus, the bell panel, the phone tab bar)
// keeps the frosted blur, as in Figma ("Glass/frost"). Without WebGL, with Reduce transparency on, or on another
// business's background, nothing changes: the CSS glass stays.

export const GLASS = { frost: 12, refraction: 1, depth: 70, dispersion: 0.85, lightAngle: -45, lightIntensity: 0.5, grain: 0.05 } as const;

/** Glass the canvas draws: cards and tiles in the page. */
const PICK = ".glass, .pov-stat";
/** Glass that floats over other cards keeps its CSS blur. */
const FLOATING = ".dialog, .menu, [role=dialog], .bell-panel, .wp-tabbar, .wp-ptop, .wp-side.drawer, .wsb-panel, .toast, .wp-morelist, .modal";
const NEAR = 300; // cards this close to the screen keep a canvas; farther ones give theirs back

const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_top;     // the drawing buffer's height (the card is drawn in its top-left corner)
uniform vec4 u_img;      // where the scene sits, relative to the card's top left: x, y, w, h (device px)
uniform vec2 u_size;     // the card, device px
uniform float u_r;       // its corner radius
uniform float u_depth;   // how far in from the edge the glass bends
uniform float u_refr;
uniform float u_disp;
uniform float u_frost;   // frost radius, device px
uniform float u_texScale;// texture px per device px
uniform float u_light;
uniform vec2 u_ldir;
uniform float u_grain;
uniform float u_dpr;
out vec4 o;

float sd(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec3 scene(vec2 px, float lod) { return textureLod(u_tex, (px - u_img.xy) / u_img.zw, lod).rgb; }
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_top - gl_FragCoord.y);   // card-local, from its top left
  vec2 h = u_size * 0.5;
  vec2 p = px - h;
  float r = min(u_r, min(h.x, h.y));
  float d = sd(p, h, r);
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  // Nov 6 (Heston: "sharp artifacts", "refracting too early"; study Apple's glass): real refraction, like Apple's
  // Liquid Glass. The edge is a narrow convex squircle bevel (height (1-(1-x)^4)^(1/4)), flat and clear in the middle.
  // A straight-down ray is bent by Snell's law (index 1.5) where the surface tilts, so near the rim it lands *inward*:
  // the rim shows what is behind the card, squeezed and magnified, never what is beside it. The bevel's normals come
  // from a rounded box whose corners are at least as round as the bevel is wide, so they never fold into a seam, and
  // the bend eases off softly at the very rim instead of running away.
  float b = min(u_depth, 0.32 * min(u_size.x, u_size.y));     // bevel width
  float R2 = min(max(r, b), min(h.x, h.y));
  float d2 = sd(p, h, R2);
  vec2 e = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(sd(p + e.xy, h, R2) - sd(p - e.xy, h, R2), sd(p + e.yx, h, R2) - sd(p - e.yx, h, R2)) + 1e-6);
  float x = clamp(-d2 / b, 0.0, 1.0);                         // 0 at the rim, 1 where the flat middle starts
  float xm = max(x, 0.004), om = 1.0 - xm;
  float sq = 1.0 - om * om * om * om;
  float height = b * pow(sq, 0.25);
  float slope = om * om * om * pow(sq, -0.75);                // d(height)/d(distance in)
  vec3 N = normalize(vec3(n * slope, 1.0));                   // the surface leans outward at the rim
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / 1.5);
  vec2 bendv = ray.xy / max(-ray.z, 0.25) * (height + 0.25 * b) * u_refr;
  float cap = 0.6 * b, m = length(bendv);
  bendv /= 1.0 + m / cap;                                      // soft limit: no hard plateau
  float lod = log2(max(1.0, u_frost * u_texScale)) - 0.6;
  vec3 col = vec3(0.0);
  float k = u_disp * 0.08;                                     // red bends a little less, blue a little more
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + 0.4;
    vec2 q = px + vec2(cos(a), sin(a)) * u_frost * 0.45;
    col += vec3(scene(q + bendv * (1.0 - k), lod).r, scene(q + bendv, lod).g, scene(q + bendv * (1.0 + k), lod).b);
  }
  col /= 6.0;
  // light from the top left: a fine specular line on the rim where it faces the light, a fainter one opposite, and a
  // soft sheen across the bevel
  float facing = dot(n, -u_ldir);
  float edge = exp(-max(-d, 0.0) / (1.1 * u_dpr));
  float rimEdge = 1.0 - x;
  col += u_light * (0.6 * edge * pow(max(facing, 0.0), 2.0) + 0.22 * edge * pow(max(-facing, 0.0), 2.0) + 0.07 * rimEdge * rimEdge * max(facing, 0.0));
  // Figma's fill layers on the glass (the CSS --glass-fill): ink 34 %, paper 2 %, and a paper sheen fading down
  vec3 ink = vec3(0.012, 0.004, 0.016), paper = vec3(0.957, 0.945, 0.914);
  col = mix(col, ink, 0.34);
  col = mix(col, paper, 0.02 + 0.02 * max(0.0, 1.0 - px.y / (0.714 * u_size.y)));
  col = mix(col, paper, step(0.5, hash(floor(px / max(1.0, u_dpr / 2.0)))) * u_grain);
  o = vec4(col * alpha, alpha);
}`;

type Shape = { el: HTMLElement; cv: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null; radius: number };

export function startGlass(host: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  if (matchMedia("(prefers-reduced-transparency: reduce)").matches) return () => {};
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
  const u = { top: U("u_top"), img: U("u_img"), size: U("u_size"), r: U("u_r"), depth: U("u_depth"), refr: U("u_refr"), disp: U("u_disp"), frost: U("u_frost"), texScale: U("u_texScale"), light: U("u_light"), ldir: U("u_ldir"), grain: U("u_grain"), dpr: U("u_dpr"), tex: U("u_tex") };
  const ang = (GLASS.lightAngle * Math.PI) / 180; // −45°: from the top left (screen y points down)
  gl.uniform2f(u.ldir, Math.cos(ang), Math.sin(ang));
  gl.uniform1f(u.refr, GLASS.refraction);
  gl.uniform1f(u.disp, GLASS.dispersion);
  gl.uniform1f(u.light, GLASS.lightIntensity);
  gl.uniform1f(u.grain, GLASS.grain);
  gl.uniform1i(u.tex, 0);

  let tex: WebGLTexture | null = null;
  let img: { w: number; h: number; phone: boolean } | null = null;
  let shapes: Shape[] = [];
  let raf = 0, dead = false, movingUntil = 0;

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
      document.documentElement.dataset.glass = "gl";
      collect(); kick();
    };
    im.onerror = () => { if (im.src.endsWith(".webp")) im.src = `/bg/${name}.jpg`; };
    im.src = `/bg/${name}.webp`;
  };
  load(phone());

  // ---------- which cards to draw ----------
  const release = (s: Shape) => { s.cv?.remove(); s.cv = null; s.ctx = null; };
  const collect = () => {
    if (!img) return;
    const next: Shape[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(PICK)) {
      const ok = !el.closest(FLOATING) && !el.parentElement?.closest(PICK) && el.getClientRects().length > 0 && getComputedStyle(el).position !== "fixed";
      const had = shapes.find((x) => x.el === el);
      if (ok) {
        el.dataset.gl = "1";
        next.push(had ?? { el, cv: null, ctx: null, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 });
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
    gl.uniform1f(u.texScale, img.w / dw);
    gl.uniform1f(u.frost, GLASS.frost * dpr);
    gl.uniform1f(u.depth, GLASS.depth * dpr);
    gl.uniform1f(u.dpr, dpr);
    for (const s of shapes) {
      const r = s.el.getBoundingClientRect();
      const near = r.bottom > -NEAR && r.top < innerHeight + NEAR && r.width >= 2 && r.height >= 2;
      if (!near) { if (s.cv) release(s); continue; }
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
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
      gl.uniform4f(u.img, dx - (r.left - box.left) * dpr, dy - (r.top - box.top) * dpr, dw, dh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      s.ctx?.clearRect(0, 0, w, h);
      s.ctx?.drawImage(glc, 0, 0, w, h, 0, 0, w, h);
    }
    // keep drawing every frame while the page is moving (momentum scrolling, transitions)
    if (performance.now() < movingUntil) raf = requestAnimationFrame(draw);
  };
  const kick = (ms = 0) => { movingUntil = Math.max(movingUntil, performance.now() + ms); if (!raf) raf = requestAnimationFrame(draw); };
  const onScroll = () => kick(250);
  const onMove = () => kick(700);
  let recollect = 0;
  const changed = () => { if (!recollect) recollect = requestAnimationFrame(() => { recollect = 0; collect(); kick(); }); };

  const ro = new ResizeObserver(() => kick());
  const mo = new MutationObserver((list) => { if (list.some((m) => !(m.target instanceof HTMLCanvasElement) && ![...m.addedNodes, ...m.removedNodes].every((n) => n instanceof HTMLCanvasElement))) changed(); });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  addEventListener("scroll", onScroll, { capture: true, passive: true });
  addEventListener("touchmove", onScroll, { passive: true });
  addEventListener("resize", changed);
  visualViewport?.addEventListener("resize", onScroll);
  addEventListener("transitionrun", onMove, true);
  addEventListener("animationstart", onMove, true);
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
