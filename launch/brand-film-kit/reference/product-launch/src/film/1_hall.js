/* =====================================================================
   WORLD H — the hall: the emblem as a monolithic doorway, light behind it
   ===================================================================== */
const HK = 0.2, EX = ex => (ex - 34) * HK, EY = ey => (70 - ey) * HK;     // emblem units → metres
const LIGHT = V3(0, 26, -22);                                          // the light behind the door
// the light is not a point: averaging these offsets gives the pool on the floor a penumbra that widens with distance
const HL = Array.from({ length: 16 }, (_, i) => { const h = (n, b) => { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; }; return [h(i + 1, 2) * 2 - 1, h(i + 1, 3) * 2 - 1]; });
const HNS = 48, HNB = 40, HZ1 = 17.4;                                  // haze slices, ray sheets, where the beam meets the floor

function buildHall() {
  const s = new T.Scene(), BG = C.obs;
  s.background = new T.Color(BG); s.fog = new T.Fog(new T.Color(BG), 46, 190);
  const floorMat = new T.MeshBasicMaterial({ color: lin('#181816'), transparent: true });
  const floor = new T.Mesh(new T.PlaneGeometry(3000, 3000), floorMat); floor.rotation.x = -Math.PI / 2; floor.renderOrder = -5; s.add(floor);
  const refl = new T.Group(); s.add(refl);                              // everything the polished floor reflects

  // the two planes of the mark. Each vertex carries how much of the door's light spills onto it.
  const spill = (x, y) => lerp(1, 0.2, clamp((Math.abs(x) - 2.8) / 2.4)) * lerp(1, 0.4, clamp((y - 10.8) / 2.2));
  const face = (quads, mat, z) => {
    const g = new GeoB(); quads.forEach(q => (q.length === 4 ? g.quad(...q.map(p => [p[0], p[1], 0])) : g.tri(...q.map(p => [p[0], p[1], 0]))));
    const geo = g.geometry(), n = geo.attributes.position.count, wts = new Float32Array(n);
    for (let i = 0; i < n; i++) wts[i] = spill(geo.attributes.position.getX(i), geo.attributes.position.getY(i));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3));
    const m = new T.Mesh(geo, mat); m.position.z = z; m.userData.wts = wts; refl.add(m); return m;
  };
  const yT = 13 - (2.4 / 5.2) * 2.2;                                   // where the light plane's sloping top crosses the jamb line
  const mL = new T.MeshBasicMaterial({ color: 0x000000, vertexColors: true, fog: false }), mS = new T.MeshBasicMaterial({ color: 0x000000, vertexColors: true, fog: false });
  const faceS = face([[[2.8, 1.2], [5.2, 0], [5.2, 13], [2.8, 13]], [[0, 10.8], [2.8, 9.8], [2.8, 13], [0, 13]], [[-5.2, 13], [0, 10.8], [0, 13]]], mS, 0.5);
  const faceL = face([[[-5.2, 0], [-2.8, 1.2], [-2.8, yT], [-5.2, 13]], [[-2.8, 9.8], [0, 10.8], [-2.8, yT]]], mL, 0.65);

  // the inner faces of the doorway and the cut feet: they are what the light catches
  const jg = new GeoB();
  jg.quad([-2.8, 1.2, 0.65], [-2.8, 1.2, -0.5], [-2.8, 9.8, -0.5], [-2.8, 9.8, 0.65]);
  jg.quad([-2.8, 9.8, 0.65], [-2.8, 9.8, -0.5], [0, 10.8, -0.5], [0, 10.8, 0.65]);
  jg.quad([2.8, 1.2, -0.5], [2.8, 1.2, 0.5], [2.8, 9.8, 0.5], [2.8, 9.8, -0.5]);
  jg.quad([0, 10.8, 0.5], [0, 10.8, -0.5], [2.8, 9.8, -0.5], [2.8, 9.8, 0.5]);
  jg.quad([-5.2, 0, 0.65], [-5.2, 0, -0.5], [-2.8, 1.2, -0.5], [-2.8, 1.2, 0.65]);
  jg.quad([2.8, 1.2, 0.5], [2.8, 1.2, -0.5], [5.2, 0, -0.5], [5.2, 0, 0.5]);
  const mJ = new T.MeshBasicMaterial({ color: 0x000000, vertexColors: true, fog: false, side: T.DoubleSide });
  refl.add(new T.Mesh(jg.geometry((x, y, z) => (z < 0 ? 1 : 0.2)), mJ));

  // door leaves and the light behind them
  const leafMat = new T.MeshBasicMaterial({ color: lin(C.obs), fog: false });
  const leafGeo = new T.PlaneGeometry(1, 11.3); leafGeo.translate(0, 5.65, 0);
  const leafL = new T.Mesh(leafGeo, leafMat), leafR = new T.Mesh(leafGeo, leafMat);
  const backMat = new T.MeshBasicMaterial({ color: lin('#FFFDF8'), fog: false });
  const back = new T.Mesh(new T.PlaneGeometry(5.5, 11), backMat); back.position.set(0, 5.5, -0.52);
  refl.add(leafL, leafR, back);
  const glowMat = new T.SpriteMaterial({ map: GLOW.tex, color: lin(C.bone), blending: T.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0 });
  const glow = new T.Sprite(glowMat); glow.position.set(0, 5.6, 0.9); glow.scale.set(34, 34, 1); glow.renderOrder = 6; s.add(glow);

  // light on the floor and in the air: all additive, rebuilt every frame from the door's opening
  const mkDyn = (n, mat) => { const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3)); const m = new T.Mesh(g, mat); m.frustumCulled = false; return m; };
  const addMat = () => new T.MeshBasicMaterial({ vertexColors: true, blending: T.AdditiveBlending, transparent: true, depthWrite: false, side: T.DoubleSide, fog: false });
  const pool = mkDyn(HL.length * 9, addMat()), haze = mkDyn(HNS * 12, addMat()), rays = mkDyn(HNB * 3, addMat());
  pool.renderOrder = 1; haze.renderOrder = 2; rays.renderOrder = 3; s.add(pool, haze, rays);

  // the floor is laid in large slabs; their joints catch the light
  const jp = [], jc = [], fall = (x, z) => 1 / (1 + (x * x + z * z) / 240);
  for (let x = -57; x <= 57; x += 6) for (let z = 0.7; z < 72; z += 3) { jp.push(x, 0.012, z, x, 0.012, z + 3); const a = fall(x, z), b = fall(x, z + 3); jc.push(a, a, a, b, b, b); }
  for (let z = 6; z <= 72; z += 6) for (let x = -57; x < 57; x += 3) { jp.push(x, 0.012, z, x + 3, 0.012, z); const a = fall(x, z), b = fall(x + 3, z); jc.push(a, a, a, b, b, b); }
  const jgeo = new T.BufferGeometry(); jgeo.setAttribute('position', new T.Float32BufferAttribute(jp, 3)); jgeo.setAttribute('color', new T.Float32BufferAttribute(jc, 3));
  const jointMat = new T.LineBasicMaterial({ color: 0x000000, vertexColors: true, blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const joints = new T.LineSegments(jgeo, jointMat); joints.renderOrder = 0; s.add(joints);

  // dust in the beam: fine motes, and a few large soft ones that pass close to the lens
  const mkDust = (N, size, seed, gain) => {
    const rnd = lcg(seed), base = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { base[i * 4] = (rnd() - 0.5) * 12; base[i * 4 + 1] = 0.2 + rnd() * 9.6; base[i * 4 + 2] = 0.9 + rnd() * 17; base[i * 4 + 3] = rnd() * 6.28; }
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3)); dg.setAttribute('color', new T.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new T.Points(dg, new T.PointsMaterial({ size, map: GLOW.soft, vertexColors: true, blending: T.AdditiveBlending, transparent: true, depthWrite: false, sizeAttenuation: true, fog: false }));
    pts.frustumCulled = false; pts.renderOrder = 4; s.add(pts); return { pts, base, N, gain };
  };
  const dust = [mkDust(760, 0.1, 91, 0.95), mkDust(90, 0.34, 417, 0.3)];

  // the sentence, standing in the room on either side of the door
  const mkText = x0 => { const cv = document.createElement('canvas'); cv.width = 1536; cv.height = 256; const tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    const m = new T.Mesh(new T.PlaneGeometry(10.24, 1.7067), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false })); m.position.set(x0, 5.55, 0.72); m.renderOrder = 5; refl.add(m); return { cv, tex, m, key: -1 }; };
  const txtL = mkText(-6.5 - 5.12), txtR = mkText(6.5 + 5.12);
  const veil = makeVeil(s, BG, 0.4, 34);
  return { s, floorMat, refl, veil, solo: [floor, glow, pool, haze, rays, joints, dust[0].pts, dust[1].pts], rough: 0.045, gloss: 0,
    mL, mS, faceL, faceS, mJ, leafL, leafR, back, backMat, glowMat, pool, haze, rays, jointMat, dust, txtL, txtR };
}
function hallState(t) {
  if (t < 15) {
    const hgt = seg(t, 0.06, 0.6, E.out), D = E.door(clamp((t - 0.5) / 1.1));
    return { D, hgt, lit: 0, lock: 0, bright: clamp(0.25 * hgt + D) };
  }
  const close = E.soft(clamp((t - (T_LK + 0.6)) / 0.75));
  return { D: 1 - close, hgt: 1, lit: E.soft(clamp((t - (T_LK + 0.5)) / 0.8)), lock: 1, bright: Math.pow(1 - close, 0.6) };
}
function drawHallText(o, key, fn) { if (o.key === key) return; o.key = key; const x = o.cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, 1536, 256); fn(x); o.tex.needsUpdate = true; }
// keep the part of a polygon that lies above y0
function clipAbove(poly, y0) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ia = a[1] >= y0, ib = b[1] >= y0;
    if (ia) out.push(a);
    if (ia !== ib) { const u = (y0 - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * u, y0]); }
  }
  return out;
}
function applyHall(t) {
  const Hh = WORLD.H, st = hallState(t), D = st.D, w = Math.max(2.8 * D, st.lock ? 0 : 0.012);
  const lw = 2.8 - w;
  Hh.leafL.scale.x = Math.max(lw, 0.0001); Hh.leafL.position.set(-2.8 + lw / 2, 0, 0.1);
  Hh.leafR.scale.x = Math.max(lw, 0.0001); Hh.leafR.position.set(2.8 - lw / 2, 0, 0.1);
  Hh.back.scale.y = Math.max(st.hgt, 0.001);
  Hh.glowMat.opacity = 0.2 * st.bright;
  Hh.mJ.color.copy(lin(C.bone)).multiplyScalar(0.8 * D);
  // the two planes: ghosts catching spill while the door is the subject, flat brand tones once it becomes the mark
  Hh.mL.color.copy(lin(mixHex(mixHex(C.obs, C.embL, 0.13 * st.bright), C.embL, st.lit)));
  Hh.mS.color.copy(lin(mixHex(mixHex(C.obs, '#96938D', 0.11 * st.bright), C.embS, st.lit)));
  for (const f of [Hh.faceL, Hh.faceS]) { const c = f.geometry.attributes.color, wt = f.userData.wts; for (let i = 0; i < wt.length; i++) { const v = lerp(wt[i], 1, st.lit); c.setXYZ(i, v, v, v); } c.needsUpdate = true; }
  Hh.floorMat.color.copy(lin(mixHex('#181816', C.obs, st.lit)));
  Hh.gloss = 0.3 * (1 - st.lit);

  // projected light
  const Sx0 = LIGHT.x + JIT.lx * 26, Sy = LIGHT.y, Sz0 = LIGHT.z + JIT.lz * 26, ys = 10.8 - D, I = st.bright * (st.lock ? 0.75 : 1);
  const bone = lin(C.bone);
  // additive layers add up on screen, so each one is given as the brightness it should add there
  const put = (mesh, i, q, v) => { const k = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); mesh.geometry.attributes.position.setXYZ(i, q[0], q[1], q[2]); mesh.geometry.attributes.color.setXYZ(i, k, k * 0.985, k * 0.94); };
  const done = (mesh, n) => { mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.color.needsUpdate = true; mesh.geometry.setDrawRange(0, n); };
  // the pool: the opening's own shape thrown forward, once per light sample
  const nL = OPT.lean ? 4 : HL.length, PC = [1, 1, 0.34, 1, 0.34, 0.34, 0.34, 0.34, 0.1], kP = 0.5 * I / nL;
  for (let li = 0; li < nL; li++) {
    const o = HL[OPT.lean ? (li * 4 + JIT.i) % HL.length : li];
    const Sx = Sx0 + o[0] * 3.2, Sz = Sz0 + o[1] * 3.6, pr = (x, y) => { const k = Sy / (Sy - y); return [Sx + (x - Sx) * k, 0.02, Sz + (0.5 - Sz) * k]; };
    const A0 = [-w, 0.02, 0.5], A1 = [w, 0.02, 0.5], B0 = pr(-w, ys), B1 = pr(w, ys), P = pr(0, 10.8);
    [A0, A1, B1, A0, B1, B0, B0, B1, P].forEach((q, i) => put(Hh.pool, li * 9 + i, q, PC[i] * kP));
  }
  done(Hh.pool, nL * 9);
  // haze: cross-sections of the beam, stacked toward the camera
  const door = [[-w, 0], [w, 0], [w, ys], [0, 10.8], [-w, ys]];
  let n = 0;
  const nS = OPT.lean ? 16 : HNS;
  for (let i = 0; i < nS; i++) {
    const z = 0.78 + (HZ1 - 0.78) * (i + (OPT.lean ? JIT.w : 0.5)) / nS, k = (z - Sz0) / (0.5 - Sz0);
    const poly = clipAbove(door.map(p => [Sx0 + (p[0] - Sx0) * k, Sy + (p[1] - Sy) * k]), 0.03);
    if (poly.length < 3) continue;
    const c = 0.0105 * (64 / nS) * I * (0.35 + 0.65 * D) * Math.exp(-(z - 0.78) / 12);
    for (let j = 1; j < poly.length - 1; j++) for (const q of [poly[0], poly[j], poly[j + 1]]) put(Hh.haze, n++, [q[0], q[1], z], c);
  }
  done(Hh.haze, n);
  // a few rays inside the haze
  const pr0 = (x, y) => { const k = Sy / (Sy - y); return [Sx0 + (x - Sx0) * k, 0.02, Sz0 + (0.5 - Sz0) * k]; };
  const nB = OPT.lean ? HNB / 4 : HNB;
  for (let j = 0; j < nB; j++) {
    const i = OPT.lean ? j * 4 + (JIT.i % 4) : j;
    const x = lerp(-w, w, (i + 0.5) / HNB), top = (10.8 - Math.abs(x) / 2.8) * 0.985, k = 0.012 * (HNB / nB) * I * (0.4 + 0.6 * D) * (0.4 + 1.2 * hash(i * 3.7 + 11));
    put(Hh.rays, j * 3, [x, 0.02, 0.7], k); put(Hh.rays, j * 3 + 1, [x, top, 0.7], k * 0.55); put(Hh.rays, j * 3 + 2, pr0(x, top), 0);
  }
  done(Hh.rays, nB * 3);
  Hh.jointMat.color.copy(bone).multiplyScalar(0.012 * I);
  // dust: lit only where its ray back to the light passes through the open doorway
  for (const d of Hh.dust) {
    const dp = d.pts.geometry.attributes.position, dc = d.pts.geometry.attributes.color;
    for (let i = 0; i < d.N; i++) {
      const bx = d.base[i * 4], by = d.base[i * 4 + 1], bz = d.base[i * 4 + 2], ph = d.base[i * 4 + 3];
      const x = bx + Math.sin(t * 0.21 + ph) * 0.5, y = by + Math.sin(t * 0.17 + ph * 1.7) * 0.35, z = bz + Math.cos(t * 0.13 + ph * 0.6) * 0.5;
      const u = (0.5 - Sz0) / (z - Sz0), xd = Sx0 + (x - Sx0) * u, yd = Sy + (y - Sy) * u;
      const inside = Math.abs(xd) < w && yd > 0 && yd < 10.8 - Math.abs(xd) / 2.8;
      const b = inside ? d.gain * I * clamp((w - Math.abs(xd)) / 0.6 + 0.25) * (0.45 + 0.55 * Math.sin(ph * 9.1 + t * 0.9) ** 2) : 0;
      dp.setXYZ(i, x, y, z); dc.setXYZ(i, bone.r * b, bone.g * b, bone.b * b);
    }
    dp.needsUpdate = true; dc.needsUpdate = true;
  }
  // text
  const show = !st.lock;
  Hh.txtL.m.visible = Hh.txtR.m.visible = show;
  if (show) {
    const a = 1 - seg(t, 2.98, 0.3, E.lin), p1 = seg(t, 0.78, 0.8, E.out), p2 = seg(t, 1.06, 0.8, E.out), p3 = seg(t, 1.12, 0.8, E.out);
    Hh.txtL.m.material.opacity = Hh.txtR.m.material.opacity = a;
    drawHallText(Hh.txtL, Math.round(p1 * 400), x => rise(x, 'Not every home', 1516, 178, 168, f(168, 300), C.bone, p1, 0, 'right'));
    drawHallText(Hh.txtR, Math.round(p2 * 400) * 1000 + Math.round(p3 * 400), x => { const fR = f(168, 300), wIs = mw(x, fR, 'is '); rise(x, 'is', 20, 178, 168, fR, C.bone, p2); rise(x, 'accepted.', 20 + wIs, 178, 168, f(168, 300, true), C.bone, p3); });
  }
  return st;
}
function hallCam(t) {
  if (t < 15) {
    const a = seg(t, 0, 3.3, E.sine), push = E.push(clamp((t - 2.95) / 0.82));
    const p = V3(lerp(0.9, 0, a), lerp(1.45, 2.3, a), lerp(39, 29, a)), q = V3(0, lerp(5.7, 5.3, a), 0);
    p.lerp(V3(0, 5.2, 1.3), push); q.lerp(V3(0, 5.2, -30), push);
    setCam(p, q, 34, 0, 0, null, 0.08 * (1 - push), Math.max(2, p.z - 0.6));
  } else {
    const p = E.io(clamp((t - T_LK) / 1.0)), z = 2.4 * Math.pow(122.48 / 2.4, p), y = lerp(5.2, 6.5, p);
    setCam(V3(0, y, z), V3(0, y, 0), 20, 0, lerp(0, -145.5, p), null, 0);
  }
}

