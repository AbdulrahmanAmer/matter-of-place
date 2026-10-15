/* =====================================================================
   WORLD G — the gallery: submissions on plinths, the chosen house, the page, the cards
   ===================================================================== */
const HERO_I = 7;
const plinthPos = i => [((i % 5) - 2) * 8.8, (Math.floor(i / 5) - 1.5) * 6.4];
const HC = V3(0, 1.75, -3.2);                       // what the camera looks at on the chosen house
const AZ1 = 26 * D2R, EL1 = 9 * D2R, D1 = 28, FOV1 = 22, SX1 = 440, SY1 = -6;   // the aligned "photograph" pose
const FR = { x: 1010, y: 270, w: 780, h: 520 };     // where the frame sits on screen when aligned
let DF = 14;                                        // frame distance from that camera, solved so the page stands on the floor
const PIC = {}, PAGE = {};
const SCAN = [3, 11, 15, 9, HERO_I], SCAN_T = [7.2, 7.5, 7.8, 8.1, 8.4];
// The feature, recut for each place it goes: one lane of cards per channel, each in that channel's own shape.
const CHAN = [
  { name: 'INSTAGRAM', a: 90, w: 1.48, d: 1.48 },
  { name: 'X', a: 64, w: 1.96, d: 1.1 },
  { name: 'LINKEDIN', a: 38, w: 2.08, d: 1.09 },
  { name: 'PLACE NOTES', a: 12, w: 1.22, d: 1.65, page: true }
];
const CARDS_PER = 8, LANE0 = 5.6, LANE_D = 2.5;
const lanePoint = (k, L) => { const a = CHAN[k].a * D2R; return [PAGE.base.x + Math.cos(a) * L, PAGE.base.z - Math.sin(a) * L]; };
// how far submission i has gone back into the floor at time t
const sinkT0 = i => { const sc = SCAN.indexOf(i); return sc >= 0 ? SCAN_T[sc] + 0.3 : 8.5 + 0.05 * (Math.abs((i % 5) - 2) + Math.abs(Math.floor(i / 5) - 1)); };
const sinkAt = (i, t) => (i === HERO_I ? 0 : E.io(clamp((t - sinkT0(i)) / 0.55)));
// what a declined submission leaves behind for a moment: its plan, drawn on the floor
const traceAt = (i, t) => (i === HERO_I ? 0 : seg(t, sinkT0(i) + 0.3, 0.2, E.lin) * (1 - seg(t, sinkT0(i) + 0.62, 0.62, E.io)));
// the soft darkening where a plinth meets the floor
function contactTexture() {
  const Wd = 160, Hd = 128, cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
  const x = cv.getContext('2d'), im = x.createImageData(Wd, Hd);
  for (let j = 0; j < Hd; j++) for (let i = 0; i < Wd; i++) {
    const dx = Math.max(0, Math.abs((i + 0.5) / 16 - 5) - 3.6), dz = Math.max(0, Math.abs((j + 0.5) / 16 - 4) - 2.4), d = Math.hypot(dx, dz);
    const a = (Math.exp(-d * d / 0.42) * 0.55 + Math.exp(-d / 0.9) * 0.45) * clamp((1.35 - d) / 0.5), o = (j * Wd + i) * 4;
    im.data[o] = im.data[o + 1] = im.data[o + 2] = 255; im.data[o + 3] = Math.round(a * 255);
  }
  x.putImageData(im, 0, 0);
  return new T.CanvasTexture(cv);
}

function buildGallery() {
  const s = new T.Scene();
  s.background = new T.Color(C.bone);
  s.fog = new T.Fog(new T.Color(C.bone), 40, 140);
  const th = makeTheme({ wall: '#F6F3EC', plinth: '#C9BBA2', glass: '#2A2926', pool: '#4F4C46', tree: '#F3EFE7', trunk: '#A39B8D' });
  const hemi = new T.HemisphereLight(lin('#FFFFFF'), lin('#B4A68D'), 0.6);
  const sun = makeSun(s, '#FFF9F0', 0.6);
  s.add(hemi);
  const floorMat = new T.MeshLambertMaterial({ color: lin('#EFEBE2'), transparent: true });
  const floor = new T.Mesh(new T.PlaneGeometry(3000, 3000), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.renderOrder = -5; s.add(floor);
  const refl = new T.Group(), solo = [floor]; s.add(refl);

  const plinths = [], aoTex = contactTexture();
  for (let i = 0; i < 20; i++) {
    const [x, z] = plinthPos(i), grp = new T.Group(); grp.position.set(x, 0, z);
    const pb = new GeoB().box(-3.6, 0, -2.4, 7.2, 0.5, 4.8);
    grp.add(pb.mesh(th.plinth), pb.lines(th.edge));
    let model, sc;
    if (i === HERO_I) { model = makeModel(defHero(th), th); sc = 0.28; }
    else { model = makeModel(defSmall(SMALL_DEFS[(i * 7 + 3) % SMALL_DEFS.length]), th); sc = 0.42; model.rotation.y = ((i * 3) % 4) * Math.PI / 2; }
    model.position.y = 0.5; model.scale.setScalar(sc); grp.add(model);
    // planting on some of the plinths, as an architect's model would have
    const trees = [];
    if (i !== HERO_I && hash(i * 5.3 + 2) > 0.42) {
      const n = hash(i * 9.1) > 0.6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const sx = hash(i * 3.3 + k * 7) > 0.5 ? 1 : -1, sz = hash(i * 4.7 + k * 5) > 0.5 ? 1 : -1;
        const tr = tree(th, 0, 0, 0, 0.3 + 0.16 * hash(i + k * 13.7), 0.42 + 0.3 * hash(i * 2.1 + k));
        tr.position.set(sx * (2.95 - k * 0.75), 0.5, sz * (1.82 - k * 0.2)); grp.add(tr); trees.push(tr);
      }
    }
    const ao = new T.Mesh(new T.PlaneGeometry(10, 8), new T.MeshBasicMaterial({ color: lin('#2B2419'), map: aoTex, transparent: true, depthWrite: false, opacity: 0 }));
    ao.rotation.x = -Math.PI / 2; ao.position.set(x, 0.008, z); ao.renderOrder = -4; s.add(ao); solo.push(ao);
    // the plan it leaves behind: the model's own edges laid flat, inside the outline of its plinth
    let trace = null;
    if (i !== HERO_I) {
      const src = model.userData.body.children.find(o => o.isLineSegments).geometry.attributes.position, pts = [], cy = Math.cos(model.rotation.y), sy = Math.sin(model.rotation.y);
      for (let k = 0; k < src.count; k += 2) {
        const ax = src.getX(k) * sc, az = src.getZ(k) * sc, bx = src.getX(k + 1) * sc, bz = src.getZ(k + 1) * sc;
        if (Math.hypot(ax - bx, az - bz) < 0.01) continue;            // verticals fold to nothing
        pts.push(ax * cy + az * sy, 0, -ax * sy + az * cy, bx * cy + bz * sy, 0, -bx * sy + bz * cy);
      }
      for (const [a, b] of [[[-3.6, -2.4], [3.6, -2.4]], [[3.6, -2.4], [3.6, 2.4]], [[3.6, 2.4], [-3.6, 2.4]], [[-3.6, 2.4], [-3.6, -2.4]]]) pts.push(a[0], 0, a[1], b[0], 0, b[1]);
      const tg = new T.BufferGeometry(); tg.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      trace = new T.LineSegments(tg, new T.LineBasicMaterial({ color: lin(C.obs), transparent: true, opacity: 0 }));
      trace.position.set(x, 0.01, z); trace.visible = false; s.add(trace); solo.push(trace);
    }
    refl.add(grp);
    plinths.push({ grp, model, trees, ao, trace, x, z, sc, col: i % 5, row: Math.floor(i / 5) });
  }
  // evening: the house lights come on
  const lampMat = new T.SpriteMaterial({ map: GLOW.tex, color: lin('#F6D9A2'), blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 });
  const lamp = new T.Sprite(lampMat); lamp.position.set(-0.85, 1.75, -2.5); lamp.scale.set(5.6, 2.6, 1); refl.add(lamp);

  // the aligned pose, and everything derived from it
  const c1 = new T.PerspectiveCamera(FOV1, 16 / 9, 0.1, 2000);
  c1.position.copy(orbit(HC, AZ1, EL1, D1)); c1.lookAt(HC); c1.updateMatrixWorld(true);
  const q1 = c1.quaternion.clone(), fwd = V3(0, 0, -1).applyQuaternion(q1), up = V3(0, 1, 0).applyQuaternion(q1), right = V3(1, 0, 0).applyQuaternion(q1);
  const fpx = (H / 2) / Math.tan(FOV1 * D2R / 2);                       // pixels per unit at distance 1
  {
    // page base height is linear in DF: solve for the distance at which the sheet's foot meets the floor
    const ayK = -(FR.y + FR.h / 2 - H / 2 - SY1) / fpx, hK = (FR.w / fpx) / (480 / 560) * (760 / 560), drop = hK * (148 / 760 + 0.5);
    DF = (c1.position.y - 0.03) / -(fwd.y + up.y * (ayK - drop));
  }
  PIC.w = FR.w / fpx * DF; PIC.h = FR.h / fpx * DF;
  const ax = (FR.x + FR.w / 2 - W / 2 - SX1) / fpx * DF, ay = -(FR.y + FR.h / 2 - H / 2 - SY1) / fpx * DF;
  PIC.c = c1.position.clone().addScaledVector(fwd, DF).addScaledVector(right, ax).addScaledVector(up, ay);
  PAGE.w = PIC.w / (480 / 560); PAGE.h = PAGE.w * (760 / 560); PAGE.dy = (148 / 760) * PAGE.h;   // picture sits 148px above the page centre
  PAGE.c = PIC.c.clone().addScaledVector(up, -PAGE.dy);
  PAGE.q = q1; PAGE.up = up; PAGE.right = right; PAGE.n = fwd.clone().negate();
  PAGE.base = PAGE.c.clone().addScaledVector(up, -PAGE.h / 2);

  const pageG = new T.Group(); pageG.position.copy(PAGE.c); pageG.quaternion.copy(q1); refl.add(pageG);
  // frame bars, drawn on one after another
  const frameMat = new T.MeshBasicMaterial({ color: lin(C.obs) }), bars = [], bt = 0.014;
  for (const [cx, cy, w, h, ox, oy] of [[0, PIC.h / 2 + bt / 2, PIC.w + bt * 2, bt, -1, 0], [PIC.w / 2 + bt / 2, 0, bt, PIC.h + bt * 2, 0, 1], [0, -PIC.h / 2 - bt / 2, PIC.w + bt * 2, bt, 1, 0], [-PIC.w / 2 - bt / 2, 0, bt, PIC.h + bt * 2, 0, -1]]) {
    const geo = new T.BoxGeometry(w, h, 0.03); geo.translate(-ox * w / 2, -oy * h / 2, 0);     // pivot at the end the bar grows from
    const m = new T.Mesh(geo, frameMat); m.position.set(cx + ox * w / 2, PAGE.dy + cy + oy * h / 2, 0.03);
    m.userData.axis = ox ? 'x' : 'y'; pageG.add(m); bars.push(m);
  }
  // the print: one photograph of the house, taken from the aligned pose
  const rt = new T.WebGLRenderTarget(1560, 1040, { minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: true });
  rt.texture.encoding = T.sRGBEncoding; rt.texture.generateMipmaps = false;
  const printMat = new T.MeshBasicMaterial({ map: rt.texture });
  const print = new T.Mesh(new T.PlaneGeometry(PIC.w, PIC.h), printMat); print.position.set(0, PAGE.dy, 0.006); pageG.add(print);
  // the page: a slab that grows out of the picture
  const pageCv = document.createElement('canvas'); pageCv.width = 1080; pageCv.height = 1466;
  const pageTex = new T.CanvasTexture(pageCv); pageTex.encoding = T.sRGBEncoding; pageTex.anisotropy = 8;
  const pageMat = new T.MeshBasicMaterial({ map: pageTex });
  const sheetGeo = new T.PlaneGeometry(1, 1); const sheet = new T.Mesh(sheetGeo, pageMat); sheet.position.z = 0.002; pageG.add(sheet);
  const slabMat = new T.MeshLambertMaterial({ color: lin(C.ivory), emissive: lin(C.ivory), emissiveIntensity: 0 });
  const slab = new T.Mesh(new T.BoxGeometry(1, 1, 0.09), slabMat); slab.position.z = -0.046; slab.castShadow = true; pageG.add(slab);

  // cards: each lane is the feature cut to one channel's proportions, so the crop is in the geometry
  const cardSide = new T.MeshLambertMaterial({ color: lin(C.ivory), emissive: lin(C.ivory), emissiveIntensity: 0 });
  const cardGeo = (w, d, texAspect) => {
    const g = new T.BoxGeometry(w, 0.035, d), uv = g.attributes.uv, A = w / d, cu = Math.min(1, A / texAspect), cv = Math.min(1, texAspect / A);
    for (let i = 8; i < 12; i++) uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * cu, 0.5 + (uv.getY(i) - 0.5) * cv);   // the top face
    return g;
  };
  const chan = CHAN.map(ch => {
    const top = new T.MeshBasicMaterial({ map: ch.page ? pageTex : rt.texture });
    const mesh = new T.InstancedMesh(cardGeo(ch.w, ch.d, ch.page ? 560 / 760 : 1.5), [cardSide, cardSide, top, cardSide, cardSide, cardSide], CARDS_PER);
    mesh.castShadow = true; mesh.frustumCulled = false; mesh.visible = false; refl.add(mesh);
    // the size at which a card sits exactly over what it copies, so it can lift off the page unnoticed
    const s0 = ch.page ? PAGE.w / ch.w : PIC.w * Math.min(1, (ch.w / ch.d) / 1.5) / ch.w;
    return { mesh, s0 };
  });
  // the newsletter's own picture, riding on its little page
  const pn = CHAN[3], pg = new T.PlaneGeometry(pn.w * (480 / 560), pn.w * (480 / 560) * (2 / 3)); pg.rotateX(-Math.PI / 2); pg.translate(0, 0.0195, -(148 / 760) * pn.d);
  const pnPhoto = new T.InstancedMesh(pg, printMat, CARDS_PER); pnPhoto.frustumCulled = false; pnPhoto.visible = false; refl.add(pnPhoto);
  // each card, once down, lights the floor around it
  const lg = new T.PlaneGeometry(1, 1); lg.rotateX(-Math.PI / 2);
  const lights = new T.InstancedMesh(lg, new T.MeshBasicMaterial({ map: GLOW.tex, blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false }), CHAN.length * CARDS_PER);
  lights.frustumCulled = false; lights.visible = false; lights.renderOrder = -3;
  for (let i = 0; i < CHAN.length * CARDS_PER; i++) lights.setColorAt(i, new T.Color(0, 0, 0));
  s.add(lights); solo.push(lights);
  const pageLight = new T.Mesh(lg, new T.MeshBasicMaterial({ map: GLOW.tex, color: lin(C.bone), blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
  pageLight.position.set(PAGE.base.x + PAGE.n.x * 2.2, 0.012, PAGE.base.z + PAGE.n.z * 2.2); pageLight.scale.set(13, 1, 10); pageLight.renderOrder = -3; s.add(pageLight); solo.push(pageLight);
  // a card's attitude while it is still part of the page
  const q0 = new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(right, PAGE.n, up.clone().negate()));

  const photo = c1.clone();
  photo.setViewOffset(W, H, FR.x - SX1, FR.y - SY1, FR.w, FR.h);
  return { s, th, hemi, sun, floorMat, refl, solo, rough: 0.05, gloss: 0, plinths, lampMat, pageG, bars, print, printMat, sheet, sheetGeo, slab, slabMat, pageCv, pageTex, pageMat,
    chan, pnPhoto, lights, pageLight, cardSide, q0, rt, photo, printed: false, pageKey: -1 };
}

// The feature page, drawn at 1080 x 1466.
function drawPageTex(G, t) {
  const u = t - T_S5, key = u < 0.25 ? 0 : u > 1.95 ? 999 : Math.round(u * 60);
  if (key === G.pageKey) return;
  G.pageKey = key;
  const cv = G.pageCv, x = cv.getContext('2d'), S = 1080 / 560, ink = C.obs;
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.fillStyle = C.ivory; x.fillRect(0, 0, cv.width, cv.height);
  x.setTransform(S, 0, 0, S, 0, 0);
  drawWM(x, 40, 27, 138, ink, 0.9 * seg(u, 0.5, 0.4, E.lin));
  tracked(x, 'FEATURE', 520, 37, 11, { color: ink, alpha: 0.6 * seg(u, 0.55, 0.4, E.lin), align: 'right', track: 0.3 });
  hair(x, 40, 54, 480 * seg(u, 0.45, 0.7, E.out), ink, 0.2);
  tracked(x, 'CALIFORNIA', 40, 432, 11.5, { color: C.sandDeep, alpha: seg(u, 0.7, 0.4, E.lin), track: 0.3 });
  rise(x, 'A house that keeps', 40, 478, 38, f(38, 400), ink, seg(u, 0.75, 0.7, E.out));
  rise(x, 'the afternoon.', 40, 522, 38, f(38, 400, true), ink, seg(u, 0.83, 0.7, E.out));
  for (let c = 0; c < 2; c++) for (let r = 0; r < 8; r++) hair(x, 40 + c * 252, 556 + r * 17, 228 * ((r === 3 || r === 7) ? 0.56 : 1) * seg(u, 0.95 + r * 0.035 + c * 0.1, 0.45, E.out), ink, 0.17, 5);
  tracked(x, 'MATTEROFPLACE.COM', 40, 736, 10, { color: ink, alpha: 0.5 * seg(u, 1.25, 0.4, E.lin), track: 0.3 });
  G.pageTex.needsUpdate = true;
}

const _m = new T.Matrix4(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _s = V3(1, 1, 1), _p = V3(0, 0, 0), _c = new T.Color(), AXX = V3(1, 0, 0), Q_FLAT = new T.Quaternion();
const duskAt = t => E.ioS(clamp((t - (T_S6 + 0.15)) / 1.7));
const dlin = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));     // screen brightness → linear
function galleryState(t) {
  // the sun never quite stands still: shadows creep across the plan, swing round to the front as the camera
  // comes down, then lengthen into evening
  const swing = E.ioS(clamp((t - 8.9) / 1.3)), dusk = duskAt(t);
  let az = lerp(lerp(-152, -126, clamp((t - 3.75) / 5.15)), -62, swing), el = lerp(34, 36, swing);
  az = lerp(az, -40, seg(t, 10.2, 1.85, E.lin)); el = lerp(el, 33, seg(t, 10.2, 1.85, E.lin));
  az = lerp(az, -30, seg(t, T_S5 + 0.05, 3, E.lin)); el = lerp(el, 30, seg(t, T_S5 + 0.05, 3, E.lin));
  az = lerp(az, -70, dusk); el = lerp(el, 11, dusk);
  return { az: az * D2R, el: el * D2R, dusk, swing };
}

function applyGallery(t, forPrint) {
  const G = WORLD.G, st = galleryState(t);
  // submissions rise; the declined sink back into the floor
  const lift = 0.4 * E.ioS(clamp((t - 8.55) / 0.9));
  for (let i = 0; i < 20; i++) {
    const P = G.plinths[i], dl = 0.05 * P.col + 0.08 * (3 - P.row);
    const g = seg(t, 3.72 + dl, 0.95, E.out), sink = sinkAt(i, t), up = i === HERO_I ? lift : 0;
    P.grp.position.y = -0.53 * sink + up;
    P.grp.visible = sink < 0.999;
    const sy = Math.max(0.0005, g * clamp(1 - sink / 0.93));          // gone before the plinth's top reaches the floor
    if (P.trace) { const a = forPrint ? 0 : traceAt(i, t); P.trace.visible = a > 0.004; P.trace.material.opacity = 0.42 * a; }
    P.model.scale.set(P.sc, P.sc * sy, P.sc);
    P.model.visible = sy > 0.03;                                      // too thin to draw cleanly: let it go
    for (const tr of P.trees) { tr.scale.set(1, sy, 1); tr.visible = sy > 0.03; }
    P.ao.material.opacity = 0.15 * (1 - sink) * (1 - up / 0.4) * (1 - 0.8 * st.dusk); P.ao.visible = P.ao.material.opacity > 0.003;
  }
  const d = sunDir(st.az, st.el), k = st.dusk;
  // warm and low, then the blue hour
  G.sun.intensity = lerp(lerp(0.6, 0.36, clamp(k * 2)), 0.15, clamp(k * 2 - 1)); G.hemi.intensity = lerp(lerp(0.6, 0.2, clamp(k * 2)), 0.075, clamp(k * 2 - 1));
  G.sun.color.copy(lin('#FFF9F0')).lerp(lin('#FFD7A3'), clamp(k * 2)).lerp(lin('#B4BFD2'), clamp(k * 2 - 1));
  const bg = mixHex(C.bone, '#141412', k);
  G.s.background.set(bg); G.s.fog.color.set(bg);
  let cx = -4, cz = 2, half = 36, fn = 26, ff = 105;
  if (t >= 5.3) { const p = E.io(clamp((t - 5.3) / 1.4)); cx = lerp(-4, 0, p); cz = lerp(2, 0, p); half = lerp(36, 30, p); fn = lerp(26, 260, p); ff = lerp(105, 700, p); }
  if (t >= 8.9) { const p = E.io(clamp((t - 8.9) / 1.1)); cx = lerp(0, 3, p); cz = lerp(0, 3, p); half = lerp(30, 15, p); fn = lerp(260, 55, p); ff = lerp(700, 190, p); }
  if (t >= T_S6) { const p = E.io(clamp((t - T_S6) / 1.4)); cx = lerp(3, 14, p); cz = lerp(3, 2, p); half = lerp(15, 40, p); fn = lerp(55, 110, p); ff = lerp(190, 420, p); }
  if (forPrint) { fn = 55; ff = 190; }
  G.s.fog.near = fn; G.s.fog.far = ff;
  aimSun(G.sun, d, cx, cz, half);
  matchFloor(G.floorMat, bg, G.hemi, G.sun, d.y);
  G.gloss = forPrint ? 0 : 0.2 * k;

  // frame → print → page
  const draw = i => seg(t, 10.1 + i * 0.2, 0.46, E.io);
  G.bars.forEach((b, i) => { const p = forPrint ? 0 : draw(i) * (1 - seg(t, T_S5 + 0.35, 0.5, E.io)); b.visible = p > 0.001; if (b.userData.axis === 'x') b.scale.set(Math.max(p, 0.001), 1, 1); else b.scale.set(1, Math.max(p, 0.001), 1); });
  const printed = !forPrint && t >= T_S5;
  G.print.visible = printed;
  const grow = E.io(clamp((t - (T_S5 + 0.1)) / 0.8));
  G.sheet.visible = G.slab.visible = printed && grow > 0.001;
  if (printed) {
    // the sheet grows from the picture rectangle out to the full page; UVs follow so nothing stretches
    const x0 = lerp(-PIC.w / 2, -PAGE.w / 2, grow), x1 = -x0, y1 = lerp(PAGE.dy + PIC.h / 2, PAGE.h / 2, grow), y0 = lerp(PAGE.dy - PIC.h / 2, -PAGE.h / 2, grow);
    const pos = G.sheetGeo.attributes.position, uv = G.sheetGeo.attributes.uv;
    pos.setXYZ(0, x0, y1, 0); pos.setXYZ(1, x1, y1, 0); pos.setXYZ(2, x0, y0, 0); pos.setXYZ(3, x1, y0, 0);
    const U = x => x / PAGE.w + 0.5, Vv = y => y / PAGE.h + 0.5;
    uv.setXY(0, U(x0), Vv(y1)); uv.setXY(1, U(x1), Vv(y1)); uv.setXY(2, U(x0), Vv(y0)); uv.setXY(3, U(x1), Vv(y0));
    pos.needsUpdate = true; uv.needsUpdate = true; G.sheetGeo.computeBoundingSphere();
    G.slab.scale.set(x1 - x0, y1 - y0, 1); G.slab.position.set(0, (y0 + y1) / 2, -0.047);
    drawPageTex(G, t);
  }
  // after dark the page and the cards are their own light, and the house has its lamps on
  const glow = k * 0.92;
  G.slabMat.emissiveIntensity = glow * 0.9; G.cardSide.emissiveIntensity = glow * 0.9;
  G.th.glass.emissive.copy(lin('#F3D7A4')).multiplyScalar(forPrint ? 0 : 0.95 * E.io(clamp((k - 0.25) / 0.6)));
  G.lampMat.opacity = forPrint ? 0 : 0.34 * E.io(clamp((k - 0.3) / 0.6));
  G.pageLight.material.opacity = 0.2 * k; G.pageLight.visible = !forPrint && k > 0.01;

  // cards
  const show = !forPrint && t > T_S6 + 0.05;
  for (const c of G.chan) c.mesh.visible = show;
  G.pnPhoto.visible = G.lights.visible = show;
  if (show) {
    for (let kk = 0; kk < CHAN.length; kk++) {
      const ch = CHAN[kk], C0 = G.chan[kk], from = ch.page ? PAGE.c : PIC.c;
      for (let j = 0; j < CARDS_PER; j++) {
        const e = clamp((t - (T_S6 + 0.11 + j * 0.088 + kk * 0.045)) / 0.98), p = E.soft(e);
        const [tx, tz] = lanePoint(kk, LANE0 + j * LANE_D);
        // off the page, over in an arc, down flat and the right way up
        _p.set(lerp(from.x + PAGE.n.x * 0.07, tx, p), lerp(from.y, 0.03, p) + Math.sin(Math.PI * p) * (2.4 + j * 0.22), lerp(from.z + PAGE.n.z * 0.07, tz, p));
        _q.copy(G.q0).slerp(Q_FLAT, E.io(clamp(p * 1.2)));
        _q.multiply(_q2.setFromAxisAngle(AXX, Math.sin(Math.PI * p) * 0.75 * (j % 2 ? 1 : -1)));
        const sc = e <= 0 ? 0.0001 : lerp(C0.s0, 1, E.out(clamp(e * 2.4)));
        _s.set(sc, sc, sc); _m.compose(_p, _q, _s); C0.mesh.setMatrixAt(j, _m);
        if (ch.page) G.pnPhoto.setMatrixAt(j, _m);
        const land = E.io(clamp((e - 0.62) / 0.38)), n = kk * CARDS_PER + j;
        _p.set(tx, 0.011, tz); _s.set(ch.w + 3.4, 1, ch.d + 3.4); _m.compose(_p, Q_FLAT, _s); G.lights.setMatrixAt(n, _m);
        const v = dlin(0.3 * land * k); G.lights.setColorAt(n, _c.setRGB(v, v * 0.97, v * 0.9));
      }
      C0.mesh.instanceMatrix.needsUpdate = true;
    }
    G.pnPhoto.instanceMatrix.needsUpdate = true; G.lights.instanceMatrix.needsUpdate = true; G.lights.instanceColor.needsUpdate = true;
  }
  return st;
}

const PLAN = t => { const drift = seg(t, T_S3, 2.2, E.lin); return [V3(-12.8 + drift * 0.6, 84 - drift * 5, 0.001), V3(-12.8 + drift * 0.6, 0, 0)]; };
function galleryCam(t) {
  const up = V3(0, 1, 0);
  if (t < 8.9) {
    // low glide across the plinths, then up into a plan view
    const a = E.soft(clamp((t - 3.4) / 2.3)), b = E.io(clamp((t - 5.3) / 1.45));
    const p = V3(lerp(-34, -14, a), lerp(1.5, 4.4, a), lerp(15.5, 22, a)), q = V3(lerp(-9, 1, a), lerp(1.0, 0.6, a), lerp(-1, -2, a));
    const [pp, pq] = PLAN(t);
    p.lerp(pp, b); q.lerp(pq, b); up.lerp(V3(0, 0, -1), b).normalize();
    setCam(p, q, lerp(lerp(42, 38, a), 30, b), 0, 0, up, lerp(0.09, 0, clamp(b * 2.5)));
    return;
  }
  // down from the plan onto an orbit round the chosen house, arriving at the aligned pose
  const o = E.ioS(clamp((t - 8.9) / 2.6)), d = E.io(clamp((t - 8.9) / 1.15));
  let az = lerp(-30 * D2R, AZ1, o), el = lerp(26 * D2R, EL1, o), dist = lerp(38, D1, o), fov = FOV1, sx = SX1, sy = SY1;
  const q = HC.clone();
  // publish: pull back and round, so the page reads as a standing sheet
  const pb = E.ioS(clamp((t - (T_S5 + 0.2)) / 2.7));
  az = lerp(az, 4 * D2R, pb); el = lerp(el, 8 * D2R, pb); dist = lerp(dist, 35, pb);
  q.lerp(V3(2.4, 2.7, 3), pb); sx = lerp(sx, 340, pb); sy = lerp(sy, 30, pb);
  // distribute: crane up as the cards go out, until the four lanes read as a fan
  const cr = E.ioS(clamp((t - (T_S6 - 0.05)) / 2.3));
  az = lerp(az, -6 * D2R, cr); el = lerp(el, 46 * D2R, cr); dist = lerp(dist, 82, cr); fov = lerp(fov, 27, cr);
  q.lerp(V3(15, 0, 1), cr); sx = lerp(sx, 392, cr); sy = lerp(sy, 54, cr);
  const p = orbit(q, az, el, dist);
  if (d < 1) {
    const [p0, q0] = PLAN(t);
    p.copy(p0.lerp(p, d)); q.copy(q0.lerp(q, d)); up.copy(V3(0, 0, -1).lerp(V3(0, 1, 0), d)).normalize();
    fov = lerp(30, fov, d); sx *= d; sy *= d;
  }
  // wide open on the way down, stopped right down for the photograph, open again for the page
  const ap = 0.09 * d * (1 - seg(t, 10.0, 0.8, E.lin)) + 0.06 * pb * (1 - cr);
  setCam(p, q, fov, sx, sy, up, ap);
}

function snapPrint() {
  const G = WORLD.G;
  applyGallery(T_S5 - 0.01, true);
  G.floorMat.opacity = 1;
  renderer.setRenderTarget(G.rt); renderer.render(G.s, G.photo); renderer.setRenderTarget(null);
  G.printed = true;
}

