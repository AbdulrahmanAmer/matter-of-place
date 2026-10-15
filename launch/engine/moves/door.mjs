// W7 E3, the first signature move (ruling H108): the emblem as a door. Everything else in a reel is designed fresh;
// this repeats, so every piece reads as Matter of Place. Two halves, each a pure function of time:
//
//   open  (OPEN_S long)  the emblem stands as a doorway in the dark, its door opens, light pours through, and the
//                        camera pushes through the doorway into a wash of light. The scene cuts under the wash.
//   close (CLOSE_S long) from inside the light the camera pulls straight back, the door closes into the emblem in its
//                        two flat tones, and the lockup settles: MATTER OF PLACE and MATTEROFPLACE.COM. The reel ends.
//
// Real perspective, drawn on a 2D canvas: the engine captures with GL disabled, so the geometry is projected here, the
// way the Product Launch film drew its titles (launch/STUDY.md). Light is additive geometry (the beam, its pool on
// the floor, dust lit only inside the beam), never a gradient or a glow.
//
// Usage in a scene module (canvas: 1080 x 1920, above the scene's shots):
//   import { doorMove } from "/launch/engine/moves/door.mjs";
//   doorMove(F, { canvas, open: 0, close: 15 });        // seconds on F's clock; either may be null
// Sound: `doorCues({ open, close })` in the scene's cues.mjs (Node) returns the cues to add.

export const OPEN_S = 3.75; // five beats at 80 BPM
export const CLOSE_S = 3.25; // the name settles by 2.45 s and holds while the camera still drifts; the reel ends here
const WASH_IN = 0.28; // before `close`, the picture goes to light over the scene's last shot
const WASH_OUT = 0.4; // after `open` ends, the light clears over the scene's next shot
export const LOGO_URL =
  "/launch/brand-film-kit/reference/product-launch/logo.json";

export const C = {
  obs: "#11110F",
  floor: "#181816",
  bone: "#EEEAE1",
  sand: "#C9C0B2",
  embL: "#D8D4CC", // the emblem's left plane on Obsidian: Bone at 90 percent (brand/README.md)
  embS: "#696863", // the right plane: Bone at 40 percent
  light: "#F5F2EB", // Warm Ivory: the door light and the wash stay on the palette
  wash: "#F5F2EB",
};

// ---------- time ----------
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, p) => a + (b - a) * p;
function bez(x1, y1, x2, y2) {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const fx = (u) => ((ax * u + bx) * u + cx) * u,
    fy = (u) => ((ay * u + by) * u + cy) * u;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0,
      hi = 1,
      u = x;
    for (let i = 0; i < 30; i++) {
      const e = fx(u) - x;
      if (Math.abs(e) < 1e-6) break;
      if (e > 0) hi = u;
      else lo = u;
      u = (lo + hi) / 2;
    }
    return fy(u);
  };
}
// The film's curves (00_lib.js), so the move keeps its timing.
export const E = {
  lin: (x) => x,
  out: bez(0.16, 1, 0.3, 1),
  io: bez(0.76, 0, 0.24, 1),
  inq: bez(0.5, 0, 0.75, 0),
  soft: bez(0.4, 0, 0.2, 1),
  door: bez(0.3, 0, 0.1, 1),
  push: bez(0.66, 0, 0.22, 1),
  sine: (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x)),
};
const seg = (t, t0, d, e = E.out) => e(clamp((t - t0) / d));

// ---------- the room ----------
// Emblem units (logo.json) to metres: 0.2 m a unit, centred on x = 34, standing on y = 70. The mark is 13 m tall.
export const toWorld = ([ex, ey]) => [(ex - 34) * 0.2, (70 - ey) * 0.2];
const LIGHT = [0, 26, -22]; // the light behind the door
const Z_LIGHT_PLANE = 0.65,
  Z_SHADE_PLANE = 0.5,
  Z_LEAF = 0.1,
  Z_BACK = -0.52;
const SEAM = 0.03; // the leaves overlap where they meet, so the closed door is one dark field
const JAMB = 2.8,
  EAVE = 9.8,
  APEX = 10.8;

/** The door at time `u` into the open half: how far it is open (0..1), its light, and the camera. */
export function openState(u) {
  const hgt = seg(u, 0.06, 0.6);
  const D = E.door(clamp(u / 1.3)); // the light is the first thing that moves
  // A slow, low approach that drifts onto the centre line, then an accelerating push through the doorway.
  const a = E.sine(clamp((u + 0.35) / 3.65)); // already drifting on the first frame
  const push = E.push(clamp((u - 3.0) / 0.75)); // lands in the doorway on the cut
  const p = [
    lerp(lerp(0.9, 0, a), 0, push),
    lerp(lerp(1.45, 2.3, a), 5.2, push),
    lerp(lerp(39, 29, a), 1.3, push),
  ];
  const q = [0, lerp(lerp(5.7, 5.3, a), 5.2, push), lerp(0, -30, push)];
  return {
    D,
    hgt,
    lit: 0,
    lock: 0,
    bright: clamp(0.25 * hgt + D),
    gloss: 0.3,
    cam: { p, q, fov: 40, sy: 0 },
    // the light rises to full exactly at the cut and clears at once, so no frame of white is held
    wash:
      seg(u, OPEN_S - 0.35, 0.35, E.inq) *
      (1 - seg(u, OPEN_S, WASH_OUT, E.lin)),
  };
}

// The lockup, measured on the 1080 x 1920 frame: every line inside the reel's safe area (y 270 to 1250).
export const LOCKUP = {
  markH: 300, // the emblem, 13 m seen at the end of the pull
  markCY: 640,
  wordW: 780, // MATTER OF PLACE, the film's wordmark (letters about 52 px)
  wordTop: 860,
  ruleY: 958,
  urlBase: 1030,
  urlSize: 34, // at least 32 px (the reel's copy rule)
  url: "MATTEROFPLACE.COM",
};
const FOV_LOCK = 20;
const Z_MARK = 0.6; // the depth of the mark's two planes, between Z_SHADE_PLANE and Z_LIGHT_PLANE
const Z_CLOSE = 30; // where the close starts, under the light: the doorway fills the middle of the frame
// Distance at which the 13 m mark is LOCKUP.markH pixels tall, with the lens of the pull.
export function lockDistance(H = 1920) {
  const fpx = H / 2 / Math.tan((FOV_LOCK * Math.PI) / 360);
  return (13 * fpx) / LOCKUP.markH;
}

/** The door at time `v` into the close half (v < 0: the light rising over the scene's last shot). */
export function closeState(v, H = 1920) {
  // The pull and the closing door carry the whole lockup: the name settles while the camera still moves, so the
  // only still frames are the last beat (the motion gate allows no still run over 1.0 s).
  const close = E.soft(clamp((v - 0.3) / 1.15));
  // From the doorway full of light, already framed on the mark's centre, straight back to the lockup distance.
  const p = E.sine(clamp(v / 2.4));
  const zf = lockDistance(H);
  const z = Z_CLOSE * Math.pow(zf / Z_CLOSE, p);
  return {
    D: 1 - close,
    hgt: 1,
    lit: E.soft(clamp((v - 0.35) / 1.0)),
    lock: 1,
    bright: Math.pow(1 - close, 0.6),
    gloss: 0.3 * (1 - E.soft(clamp((v - 0.35) / 1.0))),
    cam: {
      p: [0, 6.5, z],
      q: [0, 6.5, 0],
      fov: FOV_LOCK,
      sy: LOCKUP.markCY - H / 2,
    },
    // the lockup recedes with the camera: its scale is the mark's, 1 when the pull ends
    // measured to the mark's own planes (0.5 to 0.65 m in front of the origin), not to the origin
    k: (zf - Z_MARK) / (z - Z_MARK),
    wash: v < 0 ? seg(v, -WASH_IN, WASH_IN, E.inq) : 1 - seg(v, 0, 0.4, E.lin),
    // the name starts once the mark is small enough to leave it room (k under about 1.45)
    mark: seg(v, 1.2, 0.3, E.lin),
    letter: (i) => seg(v, 1.5 + 0.03 * Math.abs(i - 6), 0.6),
    spread: lerp(1.2, 1, seg(v, 1.5, 0.95)),
    rule: seg(v, 1.9, 0.4),
    url: seg(v, 1.95, 0.5, E.lin),
  };
}

// ---------- the lens ----------
/** A camera's basis and projection; points behind the near plane are clipped by `clipNear`. */
export function lens(cam, W, H) {
  const [px, py, pz] = cam.p;
  let fx = cam.q[0] - px,
    fy = cam.q[1] - py,
    fz = cam.q[2] - pz;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward x up(0,1,0); up' = right x forward
  let rx = -fz,
    rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy;
  const fpx = H / 2 / Math.tan((cam.fov * Math.PI) / 360);
  /** @param {number[]} point a world point [x, y, z] in metres */
  const toCam = ([x, y, z]) => {
    const dx = x - px,
      dy = y - py,
      dz = z - pz;
    return [
      dx * rx + dz * rz,
      dx * ux + dy * uy + dz * uz,
      dx * fx + dy * fy + dz * fz,
    ];
  };
  /** @param {number[]} point a camera-space point from toCam */
  const toScreen = ([cx, cy, cz]) => [
    W / 2 + (cam.sx || 0) + (fpx * cx) / cz,
    H / 2 + (cam.sy || 0) - (fpx * cy) / cz,
  ];
  return { toCam, toScreen, fpx };
}

const NEAR = 0.05;
/** Keeps the part of a camera-space polygon in front of the near plane (Sutherland-Hodgman, one plane). */
export function clipNear(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const ia = a[2] >= NEAR,
      ib = b[2] >= NEAR;
    if (ia) out.push(a);
    if (ia !== ib) {
      const k = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]);
    }
  }
  return out;
}

function clipAbove(poly, y0) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      ia = a[1] >= y0,
      ib = b[1] >= y0;
    if (ia) out.push(a);
    if (ia !== ib) {
      const k = (y0 - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * k, y0]);
    }
  }
  return out;
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Returns a hex colour, so mixes nest (an rgb() string would not parse back).
export const mix = (a, b, p) => {
  const A = hex(a),
    B = hex(b);
  return `#${A.map((c, i) =>
    Math.round(lerp(c, B[i], clamp(p)))
      .toString(16)
      .padStart(2, "0"),
  ).join("")}`;
};
const rgba = (h, a) => `rgba(${hex(h).join(",")},${a})`;
const lcg = (seed) => {
  let s = seed >>> 0;
  return () => (
    (s = (Math.imul(s, 1664525) + 1013904223) >>> 0),
    s / 4294967296
  );
};

// The two planes of the mark, in metres, from logo.json's emblem.
function planes(logo) {
  return {
    light: logo.emblem.light.map(toWorld),
    shade: logo.emblem.shade.map(toWorld),
  };
}

// Dust in the beam: fixed motes that drift, lit only where their ray back to the light passes the open doorway.
const DUST = (() => {
  const r = lcg(91),
    N = 220,
    a = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    a[i * 4] = (r() - 0.5) * 12;
    a[i * 4 + 1] = 0.2 + r() * 9.6;
    a[i * 4 + 2] = 0.9 + r() * 17;
    a[i * 4 + 3] = r() * 6.28;
  }
  return { a, N };
})();

/** Which grain field a frame shows: a different one each frame (30 fps), the same for the same frame every render. */
export function grainFrame(t) {
  return Math.round(t * 30) % GRAIN_FIELDS;
}
const GRAIN_FIELDS = 6;

/** Six fine grain fields at half size, seeded, drawn doubled: light and dark specks a few levels either way. */
function grainFields(W, H) {
  const w = Math.ceil(W / 2),
    h = Math.ceil(H / 2);
  return Array.from({ length: GRAIN_FIELDS }, (_, f) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d"),
      im = g.createImageData(w, h),
      r = lcg(1009 + f * 7919);
    for (let i = 0; i < w * h; i++) {
      const n = (r() + r() + r()) / 1.5 - 1; // about normal, -1..1
      const o = i * 4;
      im.data[o] = im.data[o + 1] = im.data[o + 2] = n > 0 ? 255 : 0;
      im.data[o + 3] = Math.round(Math.abs(n) * 20);
    }
    g.putImageData(im, 0, 0);
    return cv;
  });
}

/** Keeps the hull of a set of screen points (monotone chain), so a beam is one edged shape. */
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [],
    upper = [];
  for (const q of p) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0
    )
      lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0
    )
      upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Draws the room for one state on a 2D context. `t` drives the dust; `mirror` draws the polished floor's reflection. */
function drawRoom(ctx, st, t, P, W, H) {
  const L = lens(st.cam, W, H);
  const fill = (pts3, style, alpha = 1) => {
    const cam = clipNear(pts3.map(L.toCam));
    if (cam.length < 3) return;
    const s = cam.map(L.toScreen);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.moveTo(s[0][0], s[0][1]);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  const D = st.D,
    w = Math.max(JAMB * D, st.lock ? 0 : 0.03),
    lw = JAMB - w,
    ys = APEX - D;
  const I = st.bright * (st.lock ? 0.75 : 1);
  const embL = mix(mix(C.obs, C.embL, 0.13 * st.bright), C.embL, st.lit);
  const embS = mix(mix(C.obs, "#96938D", 0.11 * st.bright), C.embS, st.lit);
  const jamb = mix(C.obs, C.bone, 0.55 * D * (1 - st.lit));

  // the solid things, back to front; `sy` = -1 draws them upside down for the reflection
  const solids = (sy) => {
    const at = (x, y, z) => [x, y * sy, z];
    const quad = (pts, style, alpha) =>
      fill(
        pts.map(([x, y, z]) => at(x, y, z)),
        style,
        alpha,
      );
    quad(
      [
        [-2.75, 0, Z_BACK],
        [2.75, 0, Z_BACK],
        [2.75, 11 * st.hgt, Z_BACK],
        [-2.75, 11 * st.hgt, Z_BACK],
      ],
      C.light,
    );
    if (lw > 0.0001) {
      quad(
        [
          [-JAMB, 0, Z_LEAF],
          [-JAMB + lw + SEAM, 0, Z_LEAF],
          [-JAMB + lw + SEAM, 11.3, Z_LEAF],
          [-JAMB, 11.3, Z_LEAF],
        ],
        C.obs,
      );
      quad(
        [
          [JAMB - lw - SEAM, 0, Z_LEAF],
          [JAMB, 0, Z_LEAF],
          [JAMB, 11.3, Z_LEAF],
          [JAMB - lw - SEAM, 11.3, Z_LEAF],
        ],
        C.obs,
      );
    }
    // the inner faces of the doorway: what the light catches
    if (D > 0.01 && st.lit < 0.99) {
      quad(
        [
          [-JAMB, 1.2, 0.65],
          [-JAMB, 1.2, -0.5],
          [-JAMB, EAVE, -0.5],
          [-JAMB, EAVE, 0.65],
        ],
        jamb,
      );
      quad(
        [
          [JAMB, 1.2, -0.5],
          [JAMB, 1.2, 0.5],
          [JAMB, EAVE, 0.5],
          [JAMB, EAVE, -0.5],
        ],
        jamb,
      );
      quad(
        [
          [-JAMB, EAVE, 0.65],
          [-JAMB, EAVE, -0.5],
          [0, APEX, -0.5],
          [0, APEX, 0.65],
        ],
        jamb,
      );
      quad(
        [
          [0, APEX, 0.5],
          [0, APEX, -0.5],
          [JAMB, EAVE, -0.5],
          [JAMB, EAVE, 0.5],
        ],
        jamb,
      );
    }
    quad(
      P.shade.map(([x, y]) => [x, y, Z_SHADE_PLANE]),
      embS,
    );
    quad(
      P.light.map(([x, y]) => [x, y, Z_LIGHT_PLANE]),
      embL,
    );
  };

  ctx.fillStyle = C.obs;
  ctx.fillRect(0, 0, W, H);
  if (st.gloss > 0.004) {
    solids(-1);
    // the floor runs past the camera (clipped at the lens), so the reflection shows only through its gloss
    const floor = st.lock ? C.obs : C.floor;
    fill(
      [
        [-3000, 0, -3000],
        [3000, 0, -3000],
        [3000, 0, 3000],
        [-3000, 0, 3000],
      ],
      floor,
      1 - st.gloss,
    );
  }
  solids(1);

  if (I <= 0.002) return;
  // light, added: the pool the doorway throws on the floor, the beam in the air, the dust inside it
  ctx.globalCompositeOperation = "lighter";
  const [Sx0, Sy, Sz0] = LIGHT;
  // the pool the doorway throws on the floor: one shape, one soft edge
  const pr = (x, y) => {
    const k = Sy / (Sy - y);
    return [Sx0 + (x - Sx0) * k, 0.02, Sz0 + (0.5 - Sz0) * k];
  };
  ctx.filter = "blur(9px)";
  fill(
    [[-w, 0.02, 0.5], [w, 0.02, 0.5], pr(w, ys), pr(0, APEX), pr(-w, ys)],
    rgba(C.bone, 0.13 * I),
  );
  ctx.filter = "none";
  const door = [
    [-w, 0],
    [w, 0],
    [w, ys],
    [0, APEX],
    [-w, ys],
  ];
  // the beam in the air: the doorway's outline carried toward the camera, drawn as two edged volumes (near and far)
  for (const [far, alpha] of [
    [12, 0.045],
    [5, 0.04],
  ]) {
    const section = (z) => {
      const k = (z - Sz0) / (0.5 - Sz0);
      return clipAbove(
        door.map(([x, y]) => [Sx0 + (x - Sx0) * k, Sy + (y - Sy) * k]),
        0.03,
      ).map(([x, y]) => [x, y, z]);
    };
    const pts = [...section(0.78), ...section(far)]
      .map(L.toCam)
      .filter((c) => c[2] > NEAR)
      .map(L.toScreen);
    if (pts.length < 3) continue;
    const hull = convexHull(pts);
    ctx.fillStyle = rgba(C.bone, alpha * I * (0.35 + 0.65 * D));
    ctx.beginPath();
    hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }
  for (let i = 0; i < DUST.N; i++) {
    const bx = DUST.a[i * 4],
      by = DUST.a[i * 4 + 1],
      bz = DUST.a[i * 4 + 2],
      ph = DUST.a[i * 4 + 3];
    const x = bx + Math.sin(t * 0.21 + ph) * 0.5,
      y = by + Math.sin(t * 0.17 + ph * 1.7) * 0.35,
      z = bz + Math.cos(t * 0.13 + ph * 0.6) * 0.5;
    const u = (0.5 - Sz0) / (z - Sz0),
      xd = Sx0 + (x - Sx0) * u,
      yd = Sy + (y - Sy) * u;
    if (!(Math.abs(xd) < w && yd > 0 && yd < APEX - Math.abs(xd) / JAMB))
      continue;
    if (z > 9) continue;
    const b =
      0.4 *
      I *
      clamp((w - Math.abs(xd)) / 0.6 + 0.25) *
      (0.45 + 0.55 * Math.sin(ph * 9.1 + t * 0.9) ** 2);
    const c = L.toCam([x, y, z]);
    if (c[2] < 0.3) continue;
    const [sx, sy] = L.toScreen(c),
      r = clamp((0.012 * L.fpx) / c[2], 0.5, 1.5);
    if (sx < 80 || sx > W - 80) continue;
    ctx.fillStyle = rgba(C.bone, clamp(b));
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawLockup(ctx, st, logo, letters, W, sans) {
  const about = (scale) => {
    ctx.translate(W / 2, LOCKUP.markCY);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -LOCKUP.markCY);
  };
  ctx.save();
  about(st.k);
  const k = LOCKUP.markH / 65; // emblem units 5..70
  const x0 = W / 2 - 34 * k,
    y0 = LOCKUP.markCY - 37.5 * k;
  if (st.mark > 0) {
    ctx.globalAlpha = st.mark;
    for (const [pts, color] of [
      [logo.emblem.shade, C.embS],
      [logo.emblem.light, C.embL],
    ]) {
      ctx.fillStyle = color;
      ctx.beginPath();
      pts.forEach(([ex, ey], i) =>
        i
          ? ctx.lineTo(x0 + ex * k, y0 + ey * k)
          : ctx.moveTo(x0 + ex * k, y0 + ey * k),
      );
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  // the mark follows the camera exactly; the words recede a little with it
  ctx.save();
  about(1 + (st.k - 1) * 0.5);
  // the thirteen letters fade up and rise 16 px from the centre outward while their spacing closes
  const s = LOCKUP.wordW / logo.hz.w,
    wx = W / 2 - LOCKUP.wordW / 2,
    mid = logo.hz.w / 2;
  letters.forEach((l, i) => {
    const a = st.letter(i);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(wx, LOCKUP.wordTop + (1 - a) * 16);
    ctx.scale(s, s);
    ctx.translate((l.cx - mid) * (st.spread - 1), 0);
    ctx.fillStyle = C.bone;
    ctx.fill(l.p);
    ctx.restore();
  });
  const rw = 44 * st.rule;
  if (rw > 0) {
    ctx.fillStyle = C.sand;
    ctx.fillRect(W / 2 - rw / 2, LOCKUP.ruleY, rw, 2);
  }
  if (st.url > 0) {
    ctx.save();
    ctx.globalAlpha = 0.62 * st.url;
    ctx.fillStyle = C.bone;
    ctx.font = `400 ${LOCKUP.urlSize}px ${sans}`;
    ctx.letterSpacing = `${(0.34 * LOCKUP.urlSize).toFixed(2)}px`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // letter-spacing adds after the last letter too; shift half of it back so the line sits on the centre
    ctx.fillText(LOCKUP.url, W / 2 + 0.17 * LOCKUP.urlSize, LOCKUP.urlBase);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Registers the move on a film (engine/runtime/film.js). `open` and `close` are seconds on the film's clock, or null.
 * The canvas is drawn only inside the move's windows and is clear (transparent) everywhere else.
 */
export function doorMove(
  F,
  {
    canvas,
    open = null,
    close = null,
    logo: logoUrl = LOGO_URL,
    sans = '"Jost", sans-serif',
  },
) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width,
    H = canvas.height;
  let logo = null,
    letters = [],
    P = null;
  F.waitFor(
    (async () => {
      logo = await (await fetch(logoUrl)).json();
      P = planes(logo);
      letters = logo.hz.letters.map((l) => ({
        p: new Path2D(l.d),
        cx: (l.x0 + l.x1) / 2,
      }));
      await document.fonts.load(`400 ${LOCKUP.urlSize}px ${sans}`);
    })(),
  );
  let fields = [];
  // the film's grain over the move's own frames, so even the held lockup is never a still screen
  const grain = (t) => {
    if (fields.length === 0) fields = grainFields(W, H);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fields[grainFrame(t)], 0, 0, W, H);
    ctx.restore();
  };
  const wash = (a) => {
    if (a <= 0) return;
    ctx.fillStyle = rgba(C.wash, clamp(a));
    ctx.fillRect(0, 0, W, H);
  };
  F.onRender((t) => {
    ctx.clearRect(0, 0, W, H);
    if (logo === null) return;
    // the close owns the frame from its start; before that, the open's room and either half's light
    if (close !== null && t >= close) {
      const st = closeState(t - close, H);
      drawRoom(ctx, st, t, P, W, H);
      drawLockup(ctx, st, logo, letters, W, sans);
      wash(st.wash);
      grain(t);
      return;
    }
    let light = 0;
    if (open !== null && t >= open && t < open + OPEN_S + WASH_OUT) {
      const u = t - open,
        st = openState(u);
      if (u < OPEN_S) {
        drawRoom(ctx, st, t, P, W, H);
        grain(t);
      }
      light = st.wash;
    }
    if (close !== null && t >= close - WASH_IN)
      light = Math.max(light, closeState(t - close, H).wash);
    wash(light);
  });
}

/** The move's sound, as cues for engine/runtime/audio.js (noise only, S36): add them in the scene's cues.mjs. */
/** @param {{ open?: number | null, close?: number | null }} at seconds on the scene's clock */
export function doorCues({ open = null, close = null }) {
  const cues = [];
  if (open !== null) {
    cues.push({
      t: open + 0.12,
      type: "door",
      db: -15,
      label: "the door opens",
    });
    cues.push({
      t: open + 2.9,
      type: "whoosh",
      db: -13,
      dur: 0.85,
      label: "the push through the doorway",
    });
  }
  if (close !== null) {
    cues.push({
      t: close - 0.25,
      type: "whoosh",
      db: -15,
      dur: 0.5,
      label: "back through the light",
    });
    cues.push({
      t: close + 0.3,
      type: "door",
      db: -14,
      label: "the door closes into the mark",
    });
    cues.push({
      t: close + 1.5,
      type: "paper",
      db: -24,
      dur: 0.6,
      label: "the name settles",
    });
  }
  return cues;
}
