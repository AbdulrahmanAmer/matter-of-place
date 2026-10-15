/* =====================================================================
   WORLDS CA / NY / FL — three markets, three lights
   ===================================================================== */
const MK = {
  CA: { bg: '#C9BBA2', wall: '#F8F5EE', plinth: '#B3A388', sunCol: '#FFE6C0', sunI: 0.78, hemiI: 0.46, hemiG: '#9C8E74', el: 15, az: -64, def: defHero, name: 'California', n: '01 / 03', ink: C.obs },
  NY: { bg: '#141412', wall: '#A7A39A', plinth: '#2B2B28', sunCol: '#C4CCDA', sunI: 0.3, hemiI: 0.075, hemiG: '#0E0E0D', el: 52, az: -34, def: defNY, name: 'New York', n: '02 / 03', ink: C.bone, lit: '#F0D49C', glass: '#0C0C0B', edge: '#EEEAE1', edgeA: 0.16 },
  FL: { bg: '#F6F3EC', wall: '#FFFFFF', plinth: '#D8CDB8', frond: '#CFC2A9', sunCol: '#FFFFFF', sunI: 0.58, hemiI: 0.62, hemiG: '#C6BBA4', el: 58, az: -38, def: defFL, name: 'Florida', n: '03 / 03', ink: C.obs, pool: '#6B6860' }
};
function buildMarket(key) {
  const c = MK[key], s = new T.Scene();
  s.background = new T.Color(c.bg); s.fog = new T.Fog(new T.Color(c.bg), 60, 240);
  const th = makeTheme({ wall: c.wall, plinth: c.plinth, glass: c.glass || '#2A2926', pool: c.pool || '#4F4C46', tree: c.wall, trunk: key === 'NY' ? '#6F6C65' : '#A39B8D', lit: c.lit, edge: c.edge, edgeA: c.edgeA });
  if (c.frond) th.frond = new T.MeshLambertMaterial({ color: lin(c.frond), side: T.DoubleSide });
  const hemi = new T.HemisphereLight(lin('#FFFFFF'), lin(c.hemiG), c.hemiI), sun = makeSun(s, c.sunCol, c.sunI); s.add(hemi);
  const floorMat = new T.MeshLambertMaterial({ color: lin(c.bg), transparent: key === 'NY' });
  const floor = new T.Mesh(new T.PlaneGeometry(3000, 3000), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.renderOrder = -5; s.add(floor);
  const refl = new T.Group(), solo = [floor]; s.add(refl);
  const pb = new GeoB().box(-6.9, 0, -4.9, 13.8, 0.6, 9.8); refl.add(pb.mesh(th.plinth), pb.lines(th.edge));
  const model = makeModel(c.def(th), th); model.scale.setScalar(0.5); model.position.y = 0.6; refl.add(model);
  if (key === 'CA') for (const [x, z, h, sd] of [[-8.6, -3.2, 5.6, 2], [-9.6, 1.4, 4.4, 4], [8.9, -4.2, 5.0, 7]]) refl.add(palm(th, x, 0, z, h, 1.9, (sd % 2 ? 1 : -1) * 0.12, sd));
  const palms = []; refl.traverse(o => { if (o.userData.palm) palms.push(o); });
  if (key === 'NY') {
    // street lamps: a glow at each head and a pool of light at each foot
    for (const lx of [-5.6, 0.2, 6.2]) {
      const g1 = new T.Sprite(new T.SpriteMaterial({ map: GLOW.tex, color: lin('#FFE2A8'), blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.95 }));
      g1.position.set(lx * 0.5, 0.6 + 3.2 * 0.5, 4.35 * 0.5 - 0.1); g1.scale.set(2.3, 2.3, 1); refl.add(g1);
      const pl = new T.Mesh(new T.PlaneGeometry(5.2, 5.2), new T.MeshBasicMaterial({ map: GLOW.tex, color: lin('#F2CF92'), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.2 }));
      pl.rotation.x = -Math.PI / 2; pl.position.set(lx * 0.5, 0.735, 4.35 * 0.5); refl.add(pl);
    }
    const wash = new T.Sprite(new T.SpriteMaterial({ map: GLOW.tex, color: lin('#F0D49C'), blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.11 }));
    wash.position.set(-0.6, 3.2, 1.4); wash.scale.set(17, 9.5, 1); s.add(wash); solo.push(wash);
  }
  // New York stands on a wet street: the windows and lamps come back up off the floor
  const veil = key === 'NY' ? makeVeil(s, c.bg, 4.95, 17, 1.4) : null;
  return { s, th, hemi, sun, floorMat, model, cfg: c, refl, solo, veil, palms, gloss: key === 'NY' ? 0.3 : 0, rough: 0.06 };
}
function applyMarket(key, t) {
  const M = WORLD[key], c = M.cfg, t0 = key === 'CA' ? T_CA : key === 'NY' ? T_NY : T_FL, u = clamp((t - t0) / 1.5);
  const d = sunDir((c.az + (key === 'CA' ? 10 * u : 4 * u)) * D2R, (c.el - (key === 'CA' ? 3 * u : 0)) * D2R);
  aimSun(M.sun, d, 0, 0, 13);
  matchFloor(M.floorMat, c.bg, M.hemi, M.sun, d.y);
  M.model.scale.set(0.5, 0.5 * lerp(0.82, 1, seg(t, t0 - 0.05, 0.8, E.out)), 0.5);
  M.palms.forEach((p, i) => { p.rotation.z = p.userData.lean + 0.022 * Math.sin(t * 1.7 + i * 2.1); p.rotation.x = 0.016 * Math.sin(t * 1.3 + i * 1.3); });
  // each market gets its own move: a low truck, a crane up a facade, a high arc
  const e = E.sine(u);
  if (key === 'CA') setCam(V3(lerp(-7.5, 1.5, e), lerp(2.1, 2.5, e), lerp(23.5, 22, e)), V3(lerp(-1.2, 0.6, e), 2.0, 0), 30, 330, -40, null, 0.08, 0);
  else if (key === 'NY') setCam(V3(lerp(10.5, 8.2, e), lerp(1.3, 5.4, e), lerp(18.5, 21, e)), V3(lerp(0.4, -0.4, e), lerp(2.9, 3.4, e), 0), 32, 360, -70, null, 0.08, 0);
  else setCam(orbit(V3(0, 1.2, 0), lerp(34, 20, e) * D2R, lerp(34, 29, e) * D2R, lerp(31, 28, e)), V3(0, 1.2, 0), 30, 340, 30, null, 0.08, 0);
}

