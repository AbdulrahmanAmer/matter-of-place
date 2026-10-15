/* Scene building blocks: geometry, architectural models, trees. */
const T = window.THREE;
const V3 = (x, y, z) => new T.Vector3(x, y, z);
const lin = h => new T.Color(h).convertSRGBToLinear();
const D2R = Math.PI / 180;

class GeoB {
  constructor() { this.p = []; this.n = []; this.u = []; this.e = []; }
  quad(a, b, c, d) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let i = 0; i < 6; i++) this.n.push(nx, ny, nz);
    this.u.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    return this;
  }
  tri(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.n.push(nx, ny, nz);
    this.u.push(0, 0, 1, 0, 0.5, 1);
    return this;
  }
  line(a, b) { this.e.push(a[0], a[1], a[2], b[0], b[1], b[2]); return this; }
  ring(pts) { for (let i = 0; i < pts.length; i++) this.line(pts[i], pts[(i + 1) % pts.length]); return this; }
  box(x0, y0, z0, w, h, d, edges = true) {
    const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (edges) {
      this.ring([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
      this.ring([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]]);
      this.line([x0, y0, z1], [x0, y1, z1]).line([x1, y0, z1], [x1, y1, z1]).line([x1, y0, z0], [x1, y1, z0]).line([x0, y0, z0], [x0, y1, z0]);
    }
    return this;
  }
  // roof prism; axis 'x' = ridge runs along x
  gable(x0, y0, z0, w, h, d, axis) {
    const x1 = x0 + w, z1 = z0 + d, yt = y0 + h, xm = x0 + w / 2, zm = z0 + d / 2;
    if (axis === 'x') {
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, yt, zm], [x0, yt, zm]);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, yt, zm], [x1, yt, zm]);
      this.tri([x0, y0, z0], [x0, y0, z1], [x0, yt, zm]);
      this.tri([x1, y0, z1], [x1, y0, z0], [x1, yt, zm]);
      this.line([x0, yt, zm], [x1, yt, zm]).line([x0, y0, z0], [x0, yt, zm]).line([x0, y0, z1], [x0, yt, zm]).line([x1, y0, z0], [x1, yt, zm]).line([x1, y0, z1], [x1, yt, zm]);
    } else {
      this.quad([x0, y0, z0], [x0, y0, z1], [xm, yt, z1], [xm, yt, z0]);
      this.quad([x1, y0, z1], [x1, y0, z0], [xm, yt, z0], [xm, yt, z1]);
      this.tri([x0, y0, z1], [x1, y0, z1], [xm, yt, z1]);
      this.tri([x1, y0, z0], [x0, y0, z0], [xm, yt, z0]);
      this.line([xm, yt, z0], [xm, yt, z1]).line([x0, y0, z0], [xm, yt, z0]).line([x1, y0, z0], [xm, yt, z0]).line([x0, y0, z1], [xm, yt, z1]).line([x1, y0, z1], [xm, yt, z1]);
    }
    return this;
  }
  pyramid(x0, y0, z0, w, h, d) {
    const x1 = x0 + w, z1 = z0 + d, a = [x0 + w / 2, y0 + h, z0 + d / 2];
    this.tri([x0, y0, z1], [x1, y0, z1], a).tri([x1, y0, z1], [x1, y0, z0], a).tri([x1, y0, z0], [x0, y0, z0], a).tri([x0, y0, z0], [x0, y0, z1], a);
    for (const c of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]) this.line(c, a);
    return this;
  }
  // flat rectangles for glazing and water, facing +z, -z, ±x or +y
  rz(z, x0, x1, y0, y1, dir = 1) { return dir > 0 ? this.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]) : this.quad([x1, y0, z], [x0, y0, z], [x0, y1, z], [x1, y1, z]); }
  rx(x, z0, z1, y0, y1, dir = 1) { return dir > 0 ? this.quad([x, y0, z1], [x, y0, z0], [x, y1, z0], [x, y1, z1]) : this.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]); }
  ry(y, x0, x1, z0, z1) { return this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]); }
  geometry(colorFn) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
    if (colorFn) { const c = []; for (let i = 0; i < this.p.length; i += 3) { const v = colorFn(this.p[i], this.p[i + 1], this.p[i + 2]); c.push(v, v, v); } g.setAttribute('color', new T.Float32BufferAttribute(c, 3)); }
    return g;
  }
  mesh(mat, shadow = true) { const m = new T.Mesh(this.geometry(), mat); m.castShadow = shadow; m.receiveShadow = shadow; return m; }
  lines(mat) { const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(this.e, 3)); return new T.LineSegments(g, mat); }
}

/* A theme is the set of materials one world shares. */
function makeTheme(o) {
  const L = (c, extra = {}) => new T.MeshLambertMaterial(Object.assign({ color: lin(c), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }, extra));
  return {
    wall: L(o.wall), plinth: L(o.plinth), dark: L(o.dark || '#33322E'),
    glass: new T.MeshLambertMaterial({ color: lin(o.glass || '#2A2926'), emissive: lin(o.glassGlow || '#000000') }),
    lit: new T.MeshBasicMaterial({ color: lin(o.lit || '#E7CFA0') }),
    pool: new T.MeshPhongMaterial({ color: lin(o.pool || '#5E5B53'), specular: lin('#FFFFFF'), shininess: 90 }),
    edge: new T.LineBasicMaterial({ color: lin(o.edge || '#11110F'), transparent: true, opacity: o.edgeA === undefined ? 0.3 : o.edgeA }),
    mull: new T.LineBasicMaterial({ color: lin(o.mull || '#EFEAE0'), transparent: true, opacity: 0.6 }),
    tree: L(o.tree || o.wall), trunk: L(o.trunk || '#8A8376'), palm: new T.MeshLambertMaterial({ color: lin(o.tree || o.wall), side: T.DoubleSide })
  };
}

// A model is built from three geometry builders: walls, glazing and "lit" windows, plus light lines for mullions.
function makeModel(def, th, opts = {}) {
  const g = new GeoB(), gl = new GeoB(), lt = new GeoB(), ml = new GeoB(), pool = new GeoB(), dk = new GeoB(), grp = new T.Group(), extras = [];
  def({ g, gl, lt, ml, pool, dk, add: o => extras.push(o) });
  const body = new T.Group();
  if (g.p.length) { body.add(g.mesh(th.wall)); if (opts.edges !== false) body.add(g.lines(th.edge)); }
  if (dk.p.length) { body.add(dk.mesh(th.dark)); body.add(dk.lines(th.edge)); }
  if (gl.p.length) body.add(gl.mesh(th.glass, false));
  if (lt.p.length) body.add(lt.mesh(th.lit, false));
  if (pool.p.length) { const m = pool.mesh(th.pool, false); m.receiveShadow = true; body.add(m); }
  if (ml.e.length) body.add(ml.lines(th.mull));
  for (const e of extras) body.add(e);
  grp.add(body); grp.userData.body = body;
  return grp;
}

const SPH = new Map();
function tree(th, x, y0, z, r, trunk) {
  const key = 'r'; if (!SPH.has(key)) SPH.set(key, new T.SphereGeometry(1, 20, 14));
  const grp = new T.Group();
  const s = new T.Mesh(SPH.get(key), th.tree); s.scale.setScalar(r); s.position.set(x, y0 + trunk + r * 0.75, z); s.castShadow = s.receiveShadow = true;
  const tg = new T.CylinderGeometry(0.05, 0.07, trunk + r * 0.3, 6), tm = new T.Mesh(tg, th.trunk); tm.position.set(x, y0 + (trunk + r * 0.3) / 2, z); tm.castShadow = true;
  grp.add(s, tm);
  return grp;
}
function palm(th, x, y0, z, h, L = 1.6, lean = 0.12, seed = 1) {
  const grp = new T.Group(), rnd = lcg(seed * 977 + 13);
  const tg = new T.CylinderGeometry(0.07, 0.12, h, 7); tg.translate(0, h / 2, 0);
  const tm = new T.Mesh(tg, th.frond || th.trunk); tm.castShadow = true;
  const crown = new GeoB();
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rnd() * 0.3, len = L * (0.85 + rnd() * 0.3), droop = 0.55 + rnd() * 0.35, S = 5;
    const ca = Math.cos(a), sa = Math.sin(a), px = -sa, pz = ca;
    for (let k = 0; k < S; k++) {
      const u0 = k / S, u1 = (k + 1) / S;
      const pt = u => { const r = len * u, y = len * (0.28 * Math.sin(u * 2.2) - droop * u * u); const hw = 0.3 * (1 - u) * (0.35 + 0.65 * Math.sin(Math.min(1, u * 2.4) * Math.PI / 2)) + 0.012; return [[ca * r + px * hw, h + y, sa * r + pz * hw], [ca * r - px * hw, h + y, sa * r - pz * hw]]; };
      const A = pt(u0), B = pt(u1);
      crown.quad(A[1], B[1], B[0], A[0]);
    }
  }
  const cm = new T.Mesh(crown.geometry(), th.frond || th.palm || th.tree); cm.castShadow = true; cm.receiveShadow = false;
  grp.add(tm, cm); grp.position.set(x, y0, z); grp.rotation.z = lean; grp.rotation.y = rnd() * 6.28; grp.userData.palm = true; grp.userData.lean = lean;
  return grp;
}

/* ---------- model definitions (units: metres at model scale; y up, +z toward the viewer) ---------- */

// The featured house: long glazed living wing under a floating roof, a taller block behind, pergola and lap pool.
function defHero(th) {
  return ({ g, gl, ml, pool, add }) => {
    g.box(-12, 0, -8, 24, 0.3, 16);                                   // site slab
    pool.ry(0.305, -10.5, -2.5, 3.2, 6.4);                            // lap pool
    g.box(-10.75, 0.3, 2.95, 8.5, 0.07, 0.25, false).box(-10.75, 0.3, 6.4, 8.5, 0.07, 0.25, false).box(-10.75, 0.3, 3.2, 0.25, 0.07, 3.2, false).box(-2.5, 0.3, 3.2, 0.25, 0.07, 3.2, false);
    g.box(-9, 0.3, -5, 12, 3.0, 5.5);                                 // living wing
    gl.rz(0.51, -8.6, 2.6, 0.55, 3.05);
    for (let k = 1; k < 7; k++) { const x = -8.6 + (11.2 * k) / 7; ml.line([x, 0.55, 0.52], [x, 3.05, 0.52]); }
    gl.rx(-9.01, -4.2, -0.4, 1.5, 2.9, -1);
    g.box(-10, 3.3, -5.6, 13.6, 0.35, 8.2);                           // floating roof
    gl.ry(3.66, -1.2, 2.2, -3.8, -2.0);                               // skylight
    g.box(-5.2, 3.65, -4.0, 1.1, 1.9, 1.1);                           // chimney
    g.box(3.6, 0.3, -6.5, 6.4, 5.9, 8.0);                             // tall block
    gl.rz(1.51, 4.5, 6.3, 0.3, 2.9); gl.rz(1.51, 7.3, 9.2, 3.5, 5.4);
    ml.line([5.4, 0.3, 1.52], [5.4, 2.9, 1.52]).line([7.3, 4.45, 1.52], [9.2, 4.45, 1.52]);
    gl.rx(10.01, -4.9, -1.2, 3.5, 5.4, 1); gl.rx(10.01, -4.9, -3.2, 0.9, 2.7, 1);
    for (const px of [4.4, 10.3]) for (const pz of [2.4, 6.4]) g.box(px - 0.1, 0.3, pz - 0.1, 0.2, 2.7, 0.2, false);   // pergola
    g.box(4.3, 3.0, 2.3, 6.2, 0.2, 0.2, false).box(4.3, 3.0, 6.3, 6.2, 0.2, 0.2, false);
    for (let k = 0; k < 10; k++) g.box(4.5 + k * 0.62, 3.2, 2.05, 0.16, 0.14, 4.7, false);
    g.box(-12, 0.3, -7.8, 6.5, 1.5, 0.4);                             // garden wall
    g.box(-1.6, 0.3, 4.7, 4.6, 0.45, 1.0);                            // planter
    g.box(-9.4, 0.3, 6.95, 1.6, 0.18, 0.6, false).box(-7.3, 0.3, 6.95, 1.6, 0.18, 0.6, false); // loungers
    add(tree(th, -10.9, 0.3, -1.2, 1.3, 2.2)); add(tree(th, 11.1, 0.3, 6.9, 0.95, 1.7)); add(tree(th, 0.6, 0.75, 5.2, 0.55, 0.5));
  };
}

// Small massing models. Each entry: boxes [x, y(depth away), z(up), w, d, h] in the older plan convention, converted on build.
const SMALL_DEFS = [
  [['b', -3.2, -2.2, 0, 6.4, 4.4, 2.4], ['gz', -3.2, -2.2, 2.4, 6.4, 4.4, 1.9]],
  [['b', -3.4, -2.2, 0, 6, 4.4, 2.5], ['b', -4.4, -3, 2.5, 8, 6, 0.3]],
  [['b', -1.7, -2.6, 0, 3.4, 5.2, 5.4], ['b', -0.6, -3.7, 0, 1.2, 1.1, 0.8]],
  [['b', -4, -0.6, 0, 8, 3.2, 2.5], ['b', -4, -3.8, 0, 3.2, 3.2, 2.5]],
  [['gz', -2.6, -3.2, 0, 5.2, 6.4, 4.6]],
  [['b', -2.8, -2.8, 0, 5.6, 5.6, 0.4], ['b', -1.6, -1.6, 0.4, 3.2, 3.2, 5]],
  [['b', -4, -2.4, 0, 8, 4.8, 2.8], ['gx', -4, -2.4, 2.8, 8, 4.8, 2.2]],
  [['b', -4, -3.2, 0, 1.9, 6.4, 2.4], ['b', 2.1, -3.2, 0, 1.9, 6.4, 2.4], ['b', -2.1, 1.3, 0, 4.2, 1.9, 2.4]],
  [['b', -4, -2, 0, 4, 4, 2.2], ['b', 0, -2, 0, 4, 4, 3.6]],
  [['b', -4, -2, 0, 3.6, 4, 2.2], ['gz', -4, -2, 2.2, 3.6, 4, 1.6], ['b', 0.4, -2, 0, 3.6, 4, 2.2], ['gz', 0.4, -2, 2.2, 3.6, 4, 1.6]],
  [['b', -5, -1.6, 0, 10, 3.2, 2.1], ['gx', -5, -1.6, 2.1, 10, 3.2, 1.1]],
  [['b', -4.4, -2.4, 0, 5, 4.8, 2.3], ['b', 0.6, -2.4, 0, 3.8, 4.8, 3.9], ['b', -4.8, -2.9, 2.3, 5.6, 5.8, 0.25]],
  [['b', -3.6, -2.6, 0, 7.2, 5.2, 1.6], ['b', -2.4, -1.6, 1.6, 4.8, 3.2, 1.6], ['b', -1.2, -0.8, 3.2, 2.4, 1.6, 1.6]],
  [['b', -4.6, -1.4, 0, 9.2, 2.8, 2.6], ['b', -4.6, -3.4, 0, 2.6, 2, 1.6], ['b', 2, -3.4, 0, 2.6, 2, 1.6], ['b', -5, -1.8, 2.6, 10, 3.6, 0.25]],
  [['b', -3, -3, 0, 6, 6, 2.6], ['p', -3.4, -3.4, 2.6, 6.8, 6.8, 2.2]]
];
function defSmall(def) {
  return ({ g, gl }) => {
    for (const p of def) {
      const [k, x, y, z, w, d, h] = p, x0 = x, y0 = z, z0 = -(y + d);
      if (k === 'b') {
        g.box(x0, y0, z0, w, h, d);
      } else if (k === 'gx') g.gable(x0, y0, z0, w, h, d, 'x');
      else if (k === 'gz') g.gable(x0, y0, z0, w, h, d, 'z');
      else if (k === 'p') g.pyramid(x0, y0, z0, w, h, d);
    }
  };
}

// New York: a row of brownstones with stoops, cornices, a rooftop tank, lit windows.
function defNY(th) {
  return ({ g, gl, lt, dk, add }) => {
    g.box(-11, 0, -6, 22, 0.25, 12, true);                            // sidewalk slab
    const houses = [[-8.4, 4.0, 7.4], [-4.4, 4.2, 8.6], [-0.2, 4.0, 7.0], [3.8, 4.4, 9.2]];
    let n = 0;
    for (const [x, w, h] of houses) {
      g.box(x, 0.25, -4.5, w, h, 6.5);
      g.box(x - 0.08, 0.25 + h, -4.5, w + 0.16, 0.28, 6.9);           // cornice
      g.box(x + w * 0.58, 0.25, 2.0, w * 0.32, 0.5, 1.5, false).box(x + w * 0.58, 0.75, 2.0, w * 0.32, 0.45, 1.0, false); // stoop
      gl.rz(2.012, x + w * 0.62, x + w * 0.86, 1.2, 2.9);             // door
      const rows = Math.floor((h - 2.4) / 1.55), cols = 2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const wx0 = x + 0.5 + c * (w - 1.0) / cols + 0.25, wx1 = wx0 + (w - 1.0) / cols - 0.5, wy0 = 3.2 + r * 1.55, wy1 = wy0 + 1.0;
        if (wy1 > h) continue;
        ((n * 7 + r * 3 + c * 5) % 5 < 2 ? lt : gl).rz(2.012, wx0, wx1, wy0, wy1);
        n++;
      }
      if (x < -8) for (let r = 0; r < rows; r++) for (let c = 0; c < 3; c++) ((r + c) % 4 === 1 ? lt : gl).rx(x - 0.012, -3.8 + c * 2.0, -2.8 + c * 2.0, 3.2 + r * 1.55, 4.2 + r * 1.55, -1);
    }
    dk.box(4.6, 9.73, -3.6, 1.7, 1.6, 1.7); dk.pyramid(4.5, 11.33, -3.7, 1.9, 0.8, 1.9);                    // water tank
    for (const lx of [4.75, 6.0]) for (const lz of [-3.45, -2.2]) dk.box(lx, 9.45, lz, 0.14, 0.3, 0.14, false);
    add(tree(th, -9.6, 0.25, 4.2, 1.1, 2.2)); add(tree(th, 9.4, 0.25, 4.0, 1.2, 2.4));
    for (const lx of [-5.6, 0.2, 6.2]) { g.box(lx - 0.06, 0.25, 4.6, 0.12, 3.0, 0.12, false); g.box(lx - 0.06, 3.2, 4.1, 0.12, 0.1, 0.6, false); } // street lamps
  };
}

// Florida: a glazed pavilion under a wide floating canopy, deck, long pool, palms.
function defFL(th) {
  return ({ g, gl, ml, pool, dk, add }) => {
    g.box(-12, 0, -8, 24, 0.3, 16);
    pool.ry(0.305, -10, 1.0, 3.6, 6.6);
    g.box(-10.25, 0.3, 3.35, 11.5, 0.07, 0.25, false).box(-10.25, 0.3, 6.6, 11.5, 0.07, 0.25, false).box(-10.25, 0.3, 3.6, 0.25, 0.07, 3.0, false).box(1.0, 0.3, 3.6, 0.25, 0.07, 3.0, false);
    dk.box(-5, 0.3, -3.6, 8, 1.1, 3.6);                               // recessed base
    g.box(-7, 1.4, -5, 12, 2.8, 6);                                   // raised house
    gl.rz(1.012, -6.6, 4.6, 1.75, 3.9); for (let k = 1; k < 8; k++) { const x = -6.6 + (11.2 * k) / 8; ml.line([x, 1.75, 1.02], [x, 3.9, 1.02]); }
    gl.rx(5.012, -4.4, 0.4, 1.75, 3.9, 1);
    for (const px of [-8.6, 6.6]) for (const pz of [-6.4, 2.4]) g.box(px - 0.12, 0.3, pz - 0.12, 0.24, 5.3, 0.24, false);  // canopy posts
    g.box(-9.4, 5.6, -7.2, 16.8, 0.26, 7.9);                          // canopy: solid over the house
    g.box(-9.4, 5.6, 0.7, 0.28, 0.26, 2.5, false).box(7.12, 5.6, 0.7, 0.28, 0.26, 2.5, false).box(-9.4, 5.6, 2.94, 16.8, 0.26, 0.26, false);   // and open slats over the deck
    for (let k = 0; k < 27; k++) g.box(-8.72 + k * 0.6, 5.66, 0.7, 0.16, 0.16, 2.26, false);
    gl.ry(5.865, -5.2, 1.6, -4.4, -3.2);                              // roof light
    for (let k = 0; k < 12; k++) g.box(7.6 + k * 0.32, 0.3, -6, 0.1, 2.4, 0.1, false); // screen fins
    g.box(2.2, 0.3, 4.2, 1.6, 0.18, 0.6, false).box(4.4, 0.3, 4.2, 1.6, 0.18, 0.6, false);
    add(palm(th, 9.6, 0.3, 4.6, 6.4, 2.2, 0.1, 3)); add(palm(th, -10.6, 0.3, -1.5, 5.4, 2.0, -0.12, 5)); add(palm(th, 10.6, 0.3, 1.4, 4.6, 1.8, 0.16, 8));
  };
}

// soft round sprite texture, used for glows, dust and light pools
function glowTexture(size = 256, power = 2) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 16; i++) { const u = i / 16; g.addColorStop(u, `rgba(255,255,255,${Math.pow(1 - u, power)})`); }
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new T.CanvasTexture(c); return t;
}
