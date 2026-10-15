/* =====================================================================
   WORLD PK — the four packages on a dark, polished stage
   ===================================================================== */
const PKG = [{ name: 'The Feature', price: '$295' }, { name: 'The Reach', price: '$695', rec: true }, { name: 'The Campaign', price: '$1,495' }, { name: 'Five Features', price: '$1,250' }];
const PKX = [-10.2, -3.4, 3.4, 10.2], PKW = 4.2, PKH = PKW * (760 / 560);
function buildPackages() {
  const s = new T.Scene(), G = WORLD.G, BG = C.obs;
  s.background = new T.Color(BG); s.fog = new T.Fog(new T.Color(BG), 40, 150);
  const floorMat = new T.MeshBasicMaterial({ color: lin('#161614'), transparent: true });
  const floor = new T.Mesh(new T.PlaneGeometry(3000, 3000), floorMat); floor.rotation.x = -Math.PI / 2; floor.renderOrder = -5; s.add(floor);
  const refl = new T.Group(); s.add(refl);
  // the sheets come up through the floor, so their materials are cut at it
  const cut = { clippingPlanes: [CLIP] };
  const slabMat = new T.MeshBasicMaterial({ color: lin('#D9D5CC'), ...cut }), pageMat = new T.MeshBasicMaterial({ map: G.pageTex, ...cut }), printMat = new T.MeshBasicMaterial({ map: G.rt.texture, ...cut });
  const groups = [], rings = [], solo = [floor];
  const mkSheet = w => {
    const g = new T.Group(), h = w * (760 / 560);
    const sh = new T.Mesh(new T.PlaneGeometry(w, h), pageMat); sh.position.set(0, h / 2, 0.05); g.add(sh);
    const pr = new T.Mesh(new T.PlaneGeometry(w * (480 / 560), w * (480 / 560) * (2 / 3)), printMat); pr.position.set(0, h / 2 + (148 / 760) * h, 0.056); g.add(pr);
    const sl = new T.Mesh(new T.BoxGeometry(w, h, 0.09), slabMat); sl.position.set(0, h / 2, 0); g.add(sl);
    g.rotation.x = -7 * D2R; return g;
  };
  PKX.forEach((x, i) => {
    const grp = new T.Group(); grp.position.set(x, 0, 0);
    grp.add(mkSheet(PKW));
    if (i === 2) {           // The Campaign: the feature plus its other formats
      const pm = (w, h, px, pz) => { const c = new T.Group(); const m = new T.Mesh(new T.PlaneGeometry(w, h), printMat); m.position.set(0, h / 2 + 0.12, 0.05); const b = new T.Mesh(new T.BoxGeometry(w + 0.24, h + 0.24, 0.07), slabMat); b.position.set(0, h / 2 + 0.12, 0); c.add(b, m); c.position.set(px, 0, pz); c.rotation.x = -7 * D2R; return c; };
      grp.add(pm(1.5, 1.5, 3.0, 1.5), pm(2.0, 1.2, 3.25, 2.9), pm(1.2, 1.8, -2.9, 2.2));
    }
    if (i === 3) for (let k = 1; k < 5; k++) { const e = mkSheet(PKW); e.position.set(0.42 * k, 0, -0.7 * k); grp.add(e); }   // Five Features
    if (i === 1) for (let k = 0; k < 4; k++) {  // The Reach: rings going out across the floor
      const r = new T.Mesh(new T.RingGeometry(0.985, 1, 128), new T.MeshBasicMaterial({ color: lin(C.sand), blending: T.AdditiveBlending, transparent: true, depthWrite: false, side: T.DoubleSide, opacity: 0 }));
      r.rotation.x = -Math.PI / 2; r.position.set(x, 0.02, 0.4); s.add(r); rings.push(r); solo.push(r);
    }
    const pool = new T.Mesh(new T.PlaneGeometry(13, 9), new T.MeshBasicMaterial({ map: GLOW.tex, color: lin(C.bone), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, 0.012, 1.6); s.add(pool); solo.push(pool);
    refl.add(grp); groups.push({ grp, pool });
  });
  const veil = makeVeil(s, BG, 0.2, 13.5, 1.5);
  return { s, floorMat, refl, veil, solo, rough: 0.05, gloss: 0.34, groups, rings };
}
function applyPackages(t) {
  const P = WORLD.PK;
  drawPageTex(WORLD.G, 99);
  P.groups.forEach((g, i) => {
    const e = seg(t, T_PK - 0.1 + i * 0.3, 0.9, E.out);
    g.grp.position.y = -(PKH + 0.4) * (1 - e);
    g.pool.material.opacity = 0.17 * e * (i === 1 ? 1.5 : 1);
  });
  P.rings.forEach((r, k) => { const u = ((t - T_PK - 0.9) * 0.42 + k / 4) % 1, on = seg(t, T_PK + 0.8, 0.5, E.lin), sc = 2.6 + u * 6.2; r.scale.set(sc, sc, 1); r.material.opacity = 0.75 * on * Math.pow(Math.sin(Math.PI * clamp(u)), 1.2); });
  // close on the first package, then back and across as the others come up
  const a = E.ioS(clamp((t - T_PK + 0.1) / 2.0)), d = seg(t, T_PK, 3.0, E.lin);
  const p = V3(lerp(-8.6, 1.3, a) + d * 0.9, lerp(1.7, 2.5, a), lerp(22.5, 35, a) - d * 0.8), q = V3(lerp(-7.4, 0.4, a) + d * 0.3, lerp(2.9, 3.2, a), 0), sy = lerp(0, -30, a);
  setCam(p, q, 28, 0, sy, null, 0.08, 0);
  // the reflections are faded out before they reach the title: find the floor under screen row 852 and end the veil there
  const fpx = (H / 2) / Math.tan(14 * D2R), th = Math.atan((852 - H / 2 - sy) / fpx) - Math.atan2(q.y - p.y, p.z - q.z);
  P.veil.scale.z = clamp(p.z - p.y / Math.tan(th), 4, 20) / 13.5;
}

