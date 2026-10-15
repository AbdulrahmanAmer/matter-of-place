/* =====================================================================
   WORLD WL — a wall, and afternoon light through a window
   ===================================================================== */
function buildWall() {
  const s = new T.Scene(); s.background = new T.Color(C.bone);
  const hemi = new T.HemisphereLight(lin('#FFFFFF'), lin('#FFFFFF'), 0.86), sun = makeSun(s, '#FFFBF2', 0.21); s.add(hemi);
  const b = lin(C.bone);
  const wall = new T.Mesh(new T.PlaneGeometry(240, 140), new T.MeshLambertMaterial({ color: new T.Color(Math.min(1, b.r / 0.86), Math.min(1, b.g / 0.86), Math.min(1, b.b / 0.86)) }));
  wall.receiveShadow = true; s.add(wall);
  // an unseen wall with a window in it, between the sun and what we see
  const g = new GeoB(), Z = 16, pw = 3.3, ph = 2.7, mb = 0.26, cols = 2, rows = 3, ow = cols * pw + (cols + 1) * mb, oh = rows * ph + (rows + 1) * mb;
  g.box(-120, -80, Z, 120 - ow / 2, 160, 0.2, false).box(ow / 2, -80, Z, 120 - ow / 2, 160, 0.2, false).box(-ow / 2, oh / 2, Z, ow, 80, 0.2, false).box(-ow / 2, -80, Z, ow, 80 - oh / 2, 0.2, false);
  for (let c = 0; c <= cols; c++) g.box(-ow / 2 + c * (pw + mb), -oh / 2, Z, mb, oh, 0.2, false);
  for (let r = 0; r <= rows; r++) g.box(-ow / 2, -oh / 2 + r * (ph + mb), Z, ow, mb, 0.2, false);
  const gobo = new T.Mesh(g.geometry(), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); gobo.castShadow = true; gobo.frustumCulled = false;
  const holder = new T.Group(); holder.add(gobo); s.add(holder);
  return { s, sun, hemi, holder, Z };
}
function applyWall(t) {
  const Wl = WORLD.WL, u = t - T_WL;
  const d = sunDir((-37 + u * 2.2) * D2R, (36 - u * 0.6) * D2R);
  // place the window so its light lands upper right, and slides as the sun moves
  Wl.holder.position.set(10.5 + d.x / d.z * Wl.Z, 4.4 + d.y / d.z * Wl.Z, 0);
  const sun = Wl.sun, dd = d.clone(); dd.x += JIT.lx; dd.y += JIT.lz; dd.normalize();
  sun.target.position.set(4, 0, 0); sun.position.set(4 + dd.x * 150, dd.y * 150, dd.z * 150);
  const c = sun.shadow.camera; c.left = -34; c.right = 34; c.top = 34; c.bottom = -34; c.near = 20; c.far = 320; c.updateProjectionMatrix();
  const e = seg(t, T_WL, 2.3, E.sine);
  setCam(V3(lerp(-0.6, 0.4, e), 0, lerp(41, 38.5, e)), V3(lerp(-0.6, 0.4, e), 0, 0), 30, 0, 0, null, 0);
}

