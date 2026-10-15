/* Matter of Place — Product Launch. Every frame is a pure function of time t (seconds). */
const LOGO = __LOGO__;
const WM = new Path2D(LOGO.hz.d);
const LETTERS = LOGO.hz.letters.map(l => ({ p: new Path2D(l.d), cx: (l.x0 + l.x1) / 2 }));
const EMB = LOGO.emblem;
function drawWM(ctx, x, y, w, color, alpha = 1) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); const s = w / LOGO.hz.w; ctx.scale(s, s); ctx.fillStyle = color; ctx.fill(WM); ctx.restore();
}

// One beat is 0.75 s (80 BPM); every shot starts on one.
const T_S2 = 3.75, T_S3 = 6.75, T_S4 = 9.75, T_S5 = 12.0, T_S6 = 15.0, T_CA = 17.25, T_NY = 18.75, T_FL = 20.25, T_PK = 21.75, T_WL = 24.75, T_LK = 27.0;
const OPT = { shadow: 2048, soft: true, aa: true, lean: false };   // lean: the exporter averages many sub-frames, so each one can carry fewer layers
let renderer = null, cam = null, WORLD = {}, ACTIVE = null;
// The exporter's offsets for one sub-frame, named as in the kit: x,y inside the pixel; ax,ay on the lens; lx,lz on the light;
// u,v (-1..1) drive the polished floor's roughness, w (0..1) the phase of the haze slices, i picks which light and beam layers a lean sub-frame draws.
const JIT = { x: 0, y: 0, lx: 0, lz: 0, ax: 0, ay: 0, u: 0, v: 0, w: 0.5, i: 0 };

/* ---------- camera ---------- */
const CS = { p: V3(0, 0, 10), q: V3(0, 0, 0), up: V3(0, 1, 0), fov: 30, sx: 0, sy: 0, ap: 0, focus: 0 };
function setCam(p, q, fov, sx = 0, sy = 0, up, ap = 0, focus = 0) {
  CS.p.copy(p); CS.q.copy(q); CS.fov = fov; CS.sx = sx; CS.sy = sy; CS.ap = ap; CS.focus = focus; if (up) CS.up.copy(up); else CS.up.set(0, 1, 0);
}
const _v = V3(0, 0, 0), _r = V3(0, 0, 0), _u = V3(0, 0, 0);
function applyCam() {
  cam.position.copy(CS.p); cam.up.copy(CS.up).normalize(); cam.lookAt(CS.q); cam.fov = CS.fov;
  let ox = 0, oy = 0;
  if (CS.ap > 0 && (JIT.ax || JIT.ay)) {
    // thin lens: move the camera across the aperture and shear the view so the focal plane stays put
    const F = CS.focus || CS.p.distanceTo(CS.q), fpx = (H / 2) / Math.tan(CS.fov * D2R / 2), dx = JIT.ax * CS.ap, dy = JIT.ay * CS.ap;
    cam.position.addScaledVector(_r.set(1, 0, 0).applyQuaternion(cam.quaternion), dx).addScaledVector(_u.set(0, 1, 0).applyQuaternion(cam.quaternion), dy);
    ox = -dx * fpx / F; oy = dy * fpx / F;
  }
  cam.setViewOffset(W, H, -CS.sx + JIT.x + ox, -CS.sy + JIT.y + oy, W, H);
  cam.updateMatrixWorld(true);
}
const orbit = (c, az, el, d) => V3(c.x + d * Math.sin(az) * Math.cos(el), c.y + d * Math.sin(el), c.z + d * Math.cos(az) * Math.cos(el));
function proj(x, y, z) { _v.set(x, y, z).project(cam); return [(_v.x + 1) / 2 * W, (1 - _v.y) / 2 * H, _v.z]; }
const sunDir = (az, el) => V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
function aimSun(sun, dir, cx, cz, half) {
  // light jitter turns hard shadow-map edges into real penumbrae once sub-frames are averaged
  const d = dir.clone(); d.x += JIT.lx; d.z += JIT.lz; d.normalize();
  sun.target.position.set(cx, 0, cz); sun.position.set(cx + d.x * 160, d.y * 160, cz + d.z * 160);
  const c = sun.shadow.camera; c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 20; c.far = 340; c.updateProjectionMatrix();
}
// A floor that equals the background wherever it sits in full light: a seamless studio with no horizon.
function matchFloor(mat, bg, hemi, sun, dy) {
  const b = lin(bg), k = hemi.intensity, sI = sun.intensity * Math.max(0, dy), sc = sun.color;
  mat.color.setRGB(Math.min(1, b.r / (k + sI * sc.r)), Math.min(1, b.g / (k + sI * sc.g)), Math.min(1, b.b / (k + sI * sc.b)));
}
function makeSun(s, color, intensity) {
  const sun = new T.DirectionalLight(lin(color), intensity);
  sun.castShadow = true; sun.shadow.mapSize.set(OPT.shadow, OPT.shadow); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
  s.add(sun, sun.target); return sun;
}
const GLOW = { tex: null, soft: null };

/* ---------- polished floors ----------
   A world with gloss is drawn twice: once upside down, then again the right way up with its floor laid over
   the first picture at less than full opacity. What shows through is the reflection. */
const CLIP = new T.Plane(V3(0, 1, 0), 0.004);      // materials that pass through the floor are cut at it
// The veil lies on the floor during the upside-down pass only, and fades the reflection out with distance from
// whatever is being reflected: 0 at z0, complete by z1 (toward the camera).
function makeVeil(s, bg, z0, z1, power = 1.6) {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const x = cv.getContext('2d'), im = x.createImageData(4, 256);
  for (let j = 0; j < 256; j++) { const a = 1 - Math.pow(1 - j / 255, power); for (let i = 0; i < 4; i++) { const o = (j * 4 + i) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = Math.round(a * 255); } }
  x.putImageData(im, 0, 0);
  const tex = new T.CanvasTexture(cv); tex.flipY = false; tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping;
  const g = new T.BufferGeometry(), X = 600, Z = z1 + 800;
  g.setAttribute('position', new T.Float32BufferAttribute([-X, 0, z0, X, 0, z0, X, 0, z1, -X, 0, z0, X, 0, z1, -X, 0, z1, -X, 0, z1, X, 0, z1, X, 0, Z, -X, 0, z1, X, 0, Z, -X, 0, Z], 3));
  g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1], 2));
  const m = new T.Mesh(g, new T.MeshBasicMaterial({ color: lin(bg), map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false, side: T.DoubleSide }));
  m.renderOrder = 50; m.visible = false; m.frustumCulled = false; s.add(m); return m;
}
function drawWorld(w) {
  const k = w.refl ? (w.gloss || 0) : 0;
  CLIP.normal.set(0, 1, 0);
  if (w.floorMat && w.floorMat.transparent) w.floorMat.opacity = 1 - k;
  if (k < 0.004) { renderer.render(w.s, cam); return; }
  const vis = w.solo.map(o => o.visible);
  w.solo.forEach(o => { o.visible = false; });
  // a slightly different mirror for every sub-frame turns a perfect reflection into a soft one that spreads with distance
  const rough = w.rough === undefined ? 0.05 : w.rough;
  w.refl.matrixAutoUpdate = false;
  w.refl.matrix.set(1, JIT.v * rough * 0.45, 0, 0, 0, -(1 + JIT.u * rough), 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);      // flipped, slightly stretched and sheared
  CLIP.normal.set(0, -1, 0);
  if (w.sun) { w.sun.position.y *= -1; if (w.hemi) w.hemi.position.set(0, -1, 0); }
  if (w.veil) w.veil.visible = true;
  renderer.render(w.s, cam);
  if (w.veil) w.veil.visible = false;
  if (w.sun) { w.sun.position.y *= -1; if (w.hemi) w.hemi.position.set(0, 1, 0); }
  CLIP.normal.set(0, 1, 0);
  w.refl.matrix.identity();
  w.solo.forEach((o, i) => { o.visible = vis[i]; });
  renderer.autoClearColor = false; renderer.render(w.s, cam); renderer.autoClearColor = true;     // depth is cleared, the first picture is kept
}

