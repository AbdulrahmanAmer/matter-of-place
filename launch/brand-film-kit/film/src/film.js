/* film.js - the film. Every frame is a pure function of time t (seconds): nothing is carried from one frame to the next,
   so the same code plays live, scrubs to any moment, and exports frame by frame with identical results.
   This file is a two-shot placeholder that shows the contract; replace the scenes, keep the shape. */
const W = 1920, H = 1080, DUR = 6;
const BEAT = 0.75;                                          // 80 BPM = 45 frames at 60 fps. Choose a tempo whose beat is a whole number of frames (at 30 fps: 90 BPM = 20 frames)
const T_B = 3.0;                                            // shot B starts here, on a beat
const T = window.THREE, D2R = Math.PI / 180, V3 = (x, y, z) => new T.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x), lerp = (a, b, p) => a + (b - a) * p;
function bez(x1, y1, x2, y2) {                              // CSS-style cubic-bezier easing
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return x => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 30; i++) { const e = ((ax * u + bx) * u + cx) * u - x; if (Math.abs(e) < 1e-6) break; if (e > 0) hi = u; else lo = u; u = (lo + hi) / 2; }
    return ((ay * u + by) * u + cy) * u; };
}
const E = { lin: x => x, out: bez(0.16, 1, 0.3, 1), io: bez(0.65, 0, 0.35, 1), sine: x => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x)) };
const seg = (t, t0, d, e = E.out) => e(clamp((t - t0) / d));   // progress 0..1 of a move that starts at t0 and lasts d seconds
const C = { ink: '#11110F', paper: '#EEEAE1', accent: '#C6B8A0' };            // the brand palette; materials and type use nothing else
const lin = h => new T.Color(h).convertSRGBToLinear();     // lights and materials take linear colours; scene.background and fog take display colours
const SERIF = '"Film Serif", Georgia, serif', SANS = '"Film Sans", "Helvetica Neue", Arial, sans-serif';
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const LOGO = __LOGO__;                                      // logo.json (from logo.js), or null

let renderer, cam, R = 1, WORLD = {}, ACTIVE, SHADOW = 2048;
// The exporter's offsets for one sub-frame: x,y = position inside the pixel; ax,ay = point on the lens (unit disc); lx,lz = nudge of the sun;
// u,v = two spare numbers in -1..1, w = one in 0..1 and i = a counter, for effects of your own (a mirror's roughness, the phase of a haze layer).
const JIT = { x: 0, y: 0, ax: 0, ay: 0, lx: 0, lz: 0, u: 0, v: 0, w: 0.5, i: 0 };
// Camera: position, target (the plane in focus passes through it), field of view, aperture = lens radius in scene units (0 = all sharp).
// Something at distance z is blurred by about ap * fpx * |1/F - 1/z| pixels, where F is the focus distance and fpx is about 2,000 at fov 30.
const CS = { p: V3(0, 0, 10), q: V3(0, 0, 0), fov: 30, ap: 0 }, _r = V3(0, 0, 0), _u = V3(0, 0, 0);
function setCam(p, q, fov, ap = 0) { CS.p.copy(p); CS.q.copy(q); CS.fov = fov; CS.ap = ap; }
function applyCam() {
  cam.position.copy(CS.p); cam.up.set(0, 1, 0); cam.lookAt(CS.q); cam.fov = CS.fov; let ox = 0, oy = 0;
  if (CS.ap > 0 && (JIT.ax || JIT.ay)) {                    // thin lens: move across the aperture, shear the view so the focal plane stays put
    const F = CS.p.distanceTo(CS.q), fpx = (H / 2) / Math.tan(CS.fov * D2R / 2), dx = JIT.ax * CS.ap, dy = JIT.ay * CS.ap;
    cam.position.addScaledVector(_r.set(1, 0, 0).applyQuaternion(cam.quaternion), dx).addScaledVector(_u.set(0, 1, 0).applyQuaternion(cam.quaternion), dy);
    ox = -dx * fpx / F; oy = dy * fpx / F;
  }
  cam.setViewOffset(W, H, JIT.x + ox, JIT.y + oy, W, H); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}
function proj(x, y, z) { const v = V3(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; }      // where a point in the scene sits on screen: for labels that belong to objects
function buildStudio(bg, dark) {                            // a seamless studio: floor, fog and background are one colour, so there is no horizon
  const s = new T.Scene(); s.background = new T.Color(bg); s.fog = new T.Fog(new T.Color(bg), 40, 160);           // fog range suits a scene a few tens of units across: scale it with yours
  const hemi = new T.HemisphereLight(lin('#FFFFFF'), lin(bg).multiplyScalar(0.55), dark ? 0.12 : 0.6), sun = new T.DirectionalLight(lin('#FFFFFF'), dark ? 0.35 : 0.6);   // neutral light: tints stay inside the palette
  sun.castShadow = true; sun.shadow.mapSize.set(SHADOW, SHADOW); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  const floorMat = new T.MeshLambertMaterial(), floor = new T.Mesh(new T.PlaneGeometry(3000, 3000), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  const box = new T.Mesh(new T.BoxGeometry(4, 2.4, 3), new T.MeshLambertMaterial({ color: lin(dark ? C.accent : '#F8F5EE') })); box.position.y = 1.2; box.castShadow = true;
  s.add(hemi, sun, sun.target, floor, box); return { s, bg, hemi, sun, floorMat, box };
}
function aimSun(w, az, el, cx = 0, cz = 0, half = 14) {     // sun direction; (cx, cz) and half = centre and half-width of the area that must receive shadows
  // light jitter turns hard shadow edges into real penumbrae once sub-frames are averaged
  const d = V3(Math.sin(az) * Math.cos(el) + JIT.lx, Math.sin(el), Math.cos(az) * Math.cos(el) + JIT.lz).normalize();
  w.sun.target.position.set(cx, 0, cz); w.sun.position.set(cx + d.x * 160, d.y * 160, cz + d.z * 160);
  const c = w.sun.shadow.camera; c.left = c.bottom = -half; c.right = c.top = half; c.near = 20; c.far = 340; c.updateProjectionMatrix();
  // floor colour solved so that a floor in full light renders as exactly the background colour
  const b = lin(w.bg), k = w.hemi.intensity, sI = w.sun.intensity * Math.max(0, Math.sin(el)), sc = w.sun.color;
  w.floorMat.color.setRGB(Math.min(1, b.r / (k + sI * sc.r)), Math.min(1, b.g / (k + sI * sc.g)), Math.min(1, b.b / (k + sI * sc.b)));
}
function init(canvas, o = {}) {                             // o.keep: readable canvas (export); o.aa, o.soft: off in export, where averaging does both; o.lean: true in export; o.shadow: shadow-map size (1024 on phones)
  SHADOW = o.shadow || 2048;
  renderer = new T.WebGLRenderer({ canvas, antialias: o.aa !== false, preserveDrawingBuffer: !!o.keep, powerPreference: 'high-performance' });
  renderer.outputEncoding = T.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = o.soft === false ? T.BasicShadowMap : T.PCFSoftShadowMap;
  cam = new T.PerspectiveCamera(30, W / H, 0.3, 4000);
  WORLD.A = buildStudio(C.paper, false); WORLD.B = buildStudio(C.ink, true);
}
function update(t) {                                        // which world, which light, which camera: all from t
  t = clamp(t, 0, DUR);
  if (t < T_B) { const e = seg(t, 0, T_B, E.sine); ACTIVE = WORLD.A; aimSun(ACTIVE, -50 * D2R, 40 * D2R);
    setCam(V3(lerp(-9, -3, e), lerp(1.6, 2.4, e), lerp(26, 17, e)), V3(0, 1.3, 0), 30, 0.12); }          // a low dolly-in with a shallow depth of field
  else { const e = seg(t, T_B, DUR - T_B, E.sine), a = lerp(30, -10, e) * D2R; ACTIVE = WORLD.B; aimSun(ACTIVE, 30 * D2R, 40 * D2R);
    setCam(V3(Math.sin(a) * 22, 4.5, Math.cos(a) * 22), V3(0, 1.6, 0), 28, 0.06); }                        // a slow orbit
  applyCam();
}
function render(t) { update(t); renderer.render(ACTIVE.s, cam); }
// Titles live on a separate 2D canvas laid over the picture: crisp at any size, exact tracking, and no depth-of-field blur on type.
function rise(ctx, str, x, base, size, font, color, pin, pout = 0) {       // a line that rises into a mask (pin 0..1) and leaves through its top (pout 0..1)
  if (pin <= 0 || pout >= 1) return; ctx.font = font; const w = ctx.measureText(str).width, hgt = size * 1.14;
  ctx.save(); ctx.beginPath(); ctx.rect(x - size * 0.2, base - size * 0.82, w + size * 0.4, hgt); ctx.clip();
  ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; ctx.fillText(str, x, base + (1 - pin) * hgt - pout * hgt); ctx.restore();
}
function tracked(ctx, str, x, y, size, color, track = 0.28, weight = 500, alpha = 1) {   // letter-spaced capitals, drawn glyph by glyph so tracking is identical everywhere; keep labels at 26 px or more
  if (alpha <= 0) return 0; ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `${weight} ${size}px ${SANS}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; let cx = x;
  for (const ch of str) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + size * track; } ctx.restore(); return cx - x - size * track;
}
// The supplied logo, exactly: every path with its own fill and fill rule, scaled to width w. `only` = a list of path indices to draw.
// `each(pathIndex, pieceIndex, piece)` animates the pieces (for a wordmark, its letters): return { dx, dy, a } in logo units and opacity, and each piece is drawn on its own.
function drawLogo(ctx, x, y, w, alpha = 1, only, each) {
  if (!LOGO || alpha <= 0) return; const s = w / LOGO.w; ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x - LOGO.x * s, y - LOGO.y * s); ctx.scale(s, s);
  LOGO.paths.forEach((p, i) => { if (only && !only.includes(i)) return; ctx.fillStyle = p.fill;
    if (!each) { ctx.fill(new Path2D(p.d), p.rule); return; }
    p.pieces.forEach((q, k) => { const o = each(i, k, q) || {}, a = o.a === undefined ? 1 : o.a; if (a <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.translate(o.dx || 0, o.dy || 0); ctx.fill(new Path2D(q.d), p.rule); ctx.restore(); }); });
  ctx.restore();
}
function hud(ctx, t) {
  t = clamp(t, 0, DUR); ctx.setTransform(R, 0, 0, R, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, H);
  if (t < T_B) { rise(ctx, 'One idea per shot.', 150, 300, 120, `300 120px ${SERIF}`, C.ink, seg(t, 0.3, 0.9), seg(t, T_B - 0.5, 0.4, E.io)); tracked(ctx, 'SHOT A', 156, 380, 26, C.ink, 0.28, 500, seg(t, 0.9, 0.5) * (1 - seg(t, T_B - 0.5, 0.3)));
    drawLogo(ctx, 150, 860, 520, 1 - seg(t, T_B - 0.5, 0.3), null, (i, k) => { const e = seg(t, 0.6 + 0.05 * k, 0.5); return { a: e, dy: (1 - e) * 10 }; }); }      // the logo, if there is one, arrives piece by piece
  else { rise(ctx, 'Cut on the beat.', 150, 300, 120, `italic 300 120px ${SERIF}`, C.paper, seg(t, T_B + 0.15, 0.9)); }
}
// Finishing, baked into exported frames (the page lays the same two over the canvas with CSS): a vignette, and fine grain that changes 24 times a second.
let grainC = null;
function grainTile() {
  if (grainC) return grainC; const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'), im = x.createImageData(256, 256);
  for (let i = 0; i < 65536; i++) { const v = clamp(Math.round(128 + (hash(i) + hash(i + 7e4) + hash(i + 14e4) - 1.5) * 92), 0, 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0); return (grainC = c);
}
const vignette = t => (t < T_B ? 0.08 : 0.26);              // strength at the corners: lighter on light scenes
function finish(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.44, W / 2, H / 2, H * 1.11); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${vignette(t)})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const n = Math.floor(t * 24), pat = ctx.createPattern(grainTile(), 'repeat'); if (pat.setTransform) pat.setTransform(new DOMMatrix().translate(hash(n) * 256, hash(n + 91) * 256).scale(1.5));
  ctx.save(); ctx.fillStyle = pat; ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.1; ctx.fillRect(0, 0, W, H); ctx.restore();
}
// How many sub-frames the exporter averages at the time last passed to update(): more where the lens is open (blur, in pixels, of something far behind the focus).
// Fast motion needs more too: if exported frames show separate ghost copies of a moving edge, raise the count for that shot.
function samplesAt() { const blur = CS.ap * ((H / 2) / Math.tan(CS.fov * D2R / 2)) / CS.p.distanceTo(CS.q); return blur >= 6 ? 16 : blur > 0 ? 8 : 6; }
const Film = { W, H, DUR, init, update, render, hud, finish, samplesAt, vignette, grainTile,
  cuts: [T_B],                                              // every hard cut: the exporter never lets a sub-frame cross one
  shots: [[0, 'Shot A', 'One idea per shot.'], [T_B, 'Shot B', 'Cut on the beat.']],    // the page's chapter list: start, name, one line. Need not be cuts
  fonts: [`300 100px ${SERIF}`, `italic 300 100px ${SERIF}`, `500 20px ${SANS}`],          // every face the film actually sets, and no others: loaded before the first draw
  setJitter: j => Object.assign(JIT, { x: 0, y: 0, ax: 0, ay: 0, lx: 0, lz: 0, u: 0, v: 0, w: 0.5, i: 0 }, j),
  size: (w, h) => renderer.setSize(w, h, false), setRatio: r => { R = r; } };
