// The glass (Heston, Nov 5, 19:57 and 22:03): every card is one glass, Figma's "Glass/effect" style: the scene behind it
// bends at the curved edges (refraction 100 %, depth 70), splits into red and blue at the rim (dispersion 85 %), is
// lightly frosted (12) and lit from the top left (−45°, 50 %), with a fine grain (Figma's 8 %, softened to 5 % because
// a screen shows it at every device pixel). Browsers can't bend what's behind
// a box with CSS (Safari, and so every iPhone browser, has no backdrop SVG filters), but the scene is one known picture,
// so one WebGL canvas inside the background layer draws it, refracted, under every glass card on the page, and redraws
// as the page scrolls. Cards it draws lose their CSS blur (data-gl); anything floating over other cards (dialogs, menus,
// the bell panel, the phone tab bar) keeps the frosted blur, as in Figma ("Glass/frost"). Without WebGL, with Reduce
// transparency on, or on another business's background, nothing changes: the CSS glass stays.

export const GLASS = { frost: 12, refraction: 1, depth: 70, dispersion: 0.85, lightAngle: -45, lightIntensity: 0.5, grain: 0.05 } as const;

/** Glass the canvas draws: cards and tiles in the page. */
const PICK = ".glass, .pov-stat";
/** Glass that floats over other cards keeps its CSS blur. */
const FLOATING = ".dialog, .menu, [role=dialog], .bell-panel, .wp-tabbar, .wp-ptop, .wp-side.drawer, .wsb-panel, .toast, .wp-morelist, .modal";

const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_res;      // canvas size, device px
uniform vec4 u_img;      // where the scene is drawn: x, y, w, h (device px, from the top left)
uniform vec4 u_rect;     // the card: x, y, w, h
uniform float u_r;       // its corner radius
uniform float u_depth;   // how far in from the edge the glass bends
uniform float u_refr;
uniform float u_disp;
uniform float u_frost;   // frost radius, device px
uniform float u_texScale;// texture px per device px
uniform float u_light;
uniform vec2 u_ldir;
uniform float u_grain;
out vec4 o;

float sd(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
vec3 scene(vec2 px, float lod) { return textureLod(u_tex, (px - u_img.xy) / u_img.zw, lod).rgb; }
float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 c = u_rect.xy + u_rect.zw * 0.5, h = u_rect.zw * 0.5;
  vec2 p = px - c;
  float r = min(u_r, min(h.x, h.y));
  float d = sd(p, h, r);
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  // outward normal from the shape's distance field
  vec2 e = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(sd(p + e.xy, h, r) - sd(p - e.xy, h, r), sd(p + e.yx, h, r) - sd(p - e.yx, h, r)) + 1e-6);
  float depth = min(u_depth, min(h.x, h.y));
  float t = clamp(1.0 + d / depth, 0.0, 1.0);           // 0 inside the flat middle, 1 at the rim
  float bend = 1.0 - sqrt(1.0 - t * t);                   // a rounded bevel: steepest at the rim
  vec2 off = n * bend * depth * 0.55 * u_refr;            // the scene from just outside wraps round the edge
  float lod = log2(max(1.0, u_frost * u_texScale)) - 0.6;
  // frost: a small disc of samples on a softened level
  vec3 col = vec3(0.0);
  float k = u_disp * 0.14 * bend;
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + 0.4;
    vec2 j = vec2(cos(a), sin(a)) * u_frost * 0.45;
    vec2 q = px + off + j;
    col += vec3(scene(q + off * k, lod).r, scene(q, lod).g, scene(q - off * k, lod).b);
  }
  col /= 6.0;
  // light from the top left on the bevel, a thin bright rim, and a fainter one opposite
  float facing = dot(n, -u_ldir);
  float rim = smoothstep(2.2, 0.0, -d);
  col += u_light * (0.55 * rim * pow(max(facing, 0.0), 1.5) + 0.2 * rim * pow(max(-facing, 0.0), 2.0) + 0.06 * bend * max(facing, 0.0));
  // grain: Figma's monotone noise, half the pixels at 8 %
  col = mix(col, vec3(0.96, 0.95, 0.91), step(0.5, hash(px)) * u_grain);
  o = vec4(col * alpha, alpha);
}`;

type Shape = { el: HTMLElement; clips: HTMLElement[]; radius: number };

export function startGlass(host: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {};
  if (matchMedia("(prefers-reduced-transparency: reduce)").matches) return () => {};
  // only the cactus scene (another business keeps its own light and the CSS glass)
  if (!/cactus/.test(getComputedStyle(host).backgroundImage)) return () => {};
  const canvas = document.createElement("canvas");
  canvas.className = "wp-glass";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return () => {};
  const prog = program(gl);
  if (!prog) return () => {};
  host.appendChild(canvas);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const U = (name: string) => gl.getUniformLocation(prog, name);
  const u = { res: U("u_res"), img: U("u_img"), rect: U("u_rect"), r: U("u_r"), depth: U("u_depth"), refr: U("u_refr"), disp: U("u_disp"), frost: U("u_frost"), texScale: U("u_texScale"), light: U("u_light"), ldir: U("u_ldir"), grain: U("u_grain"), tex: U("u_tex") };
  const ang = (GLASS.lightAngle * Math.PI) / 180; // −45°: from the top left (screen y points down)
  gl.uniform2f(u.ldir, Math.cos(ang), Math.sin(ang));

  let tex: WebGLTexture | null = null;
  let img: { w: number; h: number; phone: boolean } | null = null;
  let shapes: Shape[] = [];
  let dirty = true, raf = 0, dead = false;

  const phone = () => innerWidth <= 820;
  const load = (isPhone: boolean) => {
    const name = isPhone ? "cactus-phone" : "cactus-desktop";
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      if (dead) return;
      tex = tex ?? gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      img = { w: im.naturalWidth, h: im.naturalHeight, phone: isPhone };
      document.documentElement.dataset.glass = "gl";
      collect(); schedule();
    };
    im.onerror = () => { if (im.src.endsWith(".webp")) im.src = `/bg/${name}.jpg`; };
    im.src = `/bg/${name}.webp`;
  };
  load(phone());

  // ---------- which cards to draw ----------
  const clipsOf = (el: HTMLElement) => {
    const out: HTMLElement[] = [];
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll|hidden|clip)/.test(s.overflowX + s.overflowY)) out.push(p);
    }
    return out;
  };
  const collect = () => {
    const next: Shape[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(PICK)) {
      const parentGlass = el.parentElement?.closest(PICK);
      const ok = !el.closest(FLOATING) && !parentGlass && el.getClientRects().length > 0 && getComputedStyle(el).position !== "fixed";
      if (ok) { el.dataset.gl = "1"; next.push({ el, clips: clipsOf(el), radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0 }); } else if (el.dataset.gl) delete el.dataset.gl;
    }
    for (const s of shapes) if (!next.some((x) => x.el === s.el)) delete s.el.dataset.gl;
    shapes = next;
    ro.disconnect();
    for (const s of shapes) ro.observe(s.el);
  };

  // ---------- drawing ----------
  const draw = () => {
    raf = 0;
    if (!dirty || !img || !tex || dead) return;
    dirty = false;
    if (img.phone !== phone()) { load(phone()); }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const box = canvas.getBoundingClientRect();
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // the scene as the CSS draws it: cover; centred (phone: anchored to the bottom)
    const sc = Math.max(W / img.w, H / img.h), dw = img.w * sc, dh = img.h * sc;
    const dx = (W - dw) / 2, dy = img.phone ? H - dh : (H - dh) / 2;
    gl.uniform2f(u.res, W, H);
    gl.uniform4f(u.img, dx, dy, dw, dh);
    gl.uniform1f(u.texScale, img.w / dw);
    gl.uniform1f(u.refr, GLASS.refraction);
    gl.uniform1f(u.disp, GLASS.dispersion);
    gl.uniform1f(u.frost, GLASS.frost * dpr);
    gl.uniform1f(u.light, GLASS.lightIntensity);
    gl.uniform1f(u.grain, GLASS.grain);
    gl.uniform1i(u.tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.enable(gl.SCISSOR_TEST);
    for (const s of shapes) {
      const r = s.el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let x0 = r.left - box.left, y0 = r.top - box.top, x1 = x0 + r.width, y1 = y0 + r.height;
      for (const c of s.clips) {
        const k = c.getBoundingClientRect();
        x0 = Math.max(x0, k.left - box.left); y0 = Math.max(y0, k.top - box.top);
        x1 = Math.min(x1, k.right - box.left); y1 = Math.min(y1, k.bottom - box.top);
      }
      if (x1 <= x0 || y1 <= y0 || y0 > box.height || y1 < 0) continue;
      gl.scissor(Math.floor(x0 * dpr), Math.floor(H - y1 * dpr), Math.ceil((x1 - x0) * dpr) + 1, Math.ceil((y1 - y0) * dpr) + 1);
      gl.uniform4f(u.rect, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr);
      gl.uniform1f(u.r, s.radius * dpr);
      gl.uniform1f(u.depth, GLASS.depth * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };
  const schedule = () => { dirty = true; if (!raf) raf = requestAnimationFrame(draw); };
  let recollect = 0;
  const changed = () => { if (!recollect) recollect = requestAnimationFrame(() => { recollect = 0; collect(); schedule(); }); };

  const ro = new ResizeObserver(schedule);
  const mo = new MutationObserver(changed);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", changed);
  visualViewport?.addEventListener("resize", schedule);
  // transitions and animations move cards without a scroll or a mutation
  const moving = () => { const until = performance.now() + 700; const tick = () => { schedule(); if (performance.now() < until && !dead) requestAnimationFrame(tick); }; tick(); };
  addEventListener("transitionrun", moving, true);
  addEventListener("animationstart", moving, true);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); stop(); });

  function stop() {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf); cancelAnimationFrame(recollect);
    ro.disconnect(); mo.disconnect();
    removeEventListener("scroll", schedule, { capture: true });
    removeEventListener("resize", changed);
    visualViewport?.removeEventListener("resize", schedule);
    removeEventListener("transitionrun", moving, true);
    removeEventListener("animationstart", moving, true);
    for (const s of shapes) delete s.el.dataset.gl;
    delete document.documentElement.dataset.glass;
    canvas.remove();
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
