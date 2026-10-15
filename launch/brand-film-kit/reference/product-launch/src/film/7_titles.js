/* =====================================================================
   Titles: a 2D layer over the picture, pinned to it where it matters
   ===================================================================== */
const VT = [T_S3, T_S4, T_S5, T_S6], VERBS = ['curate', 'frame', 'publish', 'distribute'], VDUR = [T_S4 - T_S3, T_S5 - T_S4, T_S6 - T_S5, T_CA - T_S6];
const HEAD = [[3.95, 'SUBMITTED BY AGENTS AND OWNERS'], [T_S3, 'REVIEW COMES BEFORE PAYMENT'], [T_S4, 'EDITED BY AN EDITORIAL TEAM'], [T_S5, 'A FEATURE ON MATTEROFPLACE.COM'], [T_S6, 'INSTAGRAM · X · LINKEDIN · PLACE NOTES'], [T_CA, 'THREE MARKETS ONLY'], [T_PK, 'PAID ONLY AFTER ACCEPTANCE'], [T_WL, 'HOW A HOME IS CHOSEN']];
const CUTS = [T_CA, T_PK, T_WL];
const roll = (t, tc) => E.roll(clamp((t - (tc - 0.3)) / 0.62));
const T_INV = T_S6 + 1.0;  // nightfall: the moment the picture passes through mid-grey
function inkAt(t) {
  if (t < T_CA) return mixHex(C.obs, C.bone, E.io(clamp((t - (T_INV - 0.13)) / 0.26)));
  if (t < T_NY) return C.obs; if (t < T_FL) return C.bone; if (t < T_PK) return C.obs; if (t < T_WL) return C.bone; return C.obs;
}
function hudHead(ctx, t, ink) {
  if (t < 3.9 || t >= T_LK) return;
  const a = seg(t, 3.95, 0.6, E.lin) * (1 - seg(t, T_LK - 0.2, 0.2, E.lin));
  drawWM(ctx, 120, 76, 250, ink, a); hair(ctx, 120, 124, 1680 * seg(t, 3.95, 0.9, E.out), ink, 0.2 * a);
  HEAD.forEach(([tc, s], i) => {
    const last = i === HEAD.length - 1, nx = last ? 99 : HEAD[i + 1][0], hardIn = CUTS.includes(tc), hardOut = CUTS.includes(nx);
    if (t < tc - 0.4 || t > nx + 0.4) return;
    const pin = i === 0 ? seg(t, tc, 0.5, E.out) : hardIn ? (t >= tc ? seg(t, tc, 0.5, E.out) : 0) : roll(t, tc + 0.04);
    const pout = last ? 0 : hardOut ? (t >= nx ? 1 : 0) : roll(t, nx + 0.04);
    tracked(ctx, s, 1800, 94, 15, { color: ink, alpha: 0.74 * a, align: 'right', pin, pout });
  });
}
function hudStack(ctx, t, ink) {
  if (t < 6.4 || t >= T_CA) return;
  const X = 120, B = [426, 612, 798], S = 176, fR = f(S, 300), fI = f(S, 300, true);
  // At nightfall the three lines turn over: the dark set leaves upward as the light set comes up behind it,
  // so the words never have to pass through the colour of the picture.
  const n = [roll(t, T_INV - 0.05), roll(t, T_INV), roll(t, T_INV + 0.05)];
  rise(ctx, 'We', X, B[0], S, fR, C.obs, seg(t, 6.5, 0.8, E.out), n[0]);
  for (let i = 0; i < 4; i++) rise(ctx, VERBS[i], X - 4, B[1], S, fI, C.obs, i ? roll(t, VT[i]) : seg(t, 6.58, 0.75, E.out), i < 3 ? roll(t, VT[i + 1]) : n[1]);
  rise(ctx, 'it.', X, B[2], S, fR, C.obs, seg(t, 6.66, 0.8, E.out), n[2]);
  if (n[0] > 0) { rise(ctx, 'We', X, B[0], S, fR, C.bone, n[0]); rise(ctx, VERBS[3], X - 4, B[1], S, fI, C.bone, n[1]); rise(ctx, 'it.', X, B[2], S, fR, C.bone, n[2]); }
  const a = seg(t, 6.7, 0.5, E.lin);
  if (a > 0) {
    let cur = 0; for (let i = 0; i < 4; i++) if (t >= VT[i]) cur = i;
    for (let i = 0; i < 4; i++) { hair(ctx, X + i * 72, 250, 62, ink, 0.18 * a, 2); hair(ctx, X + i * 72, 250, 62 * clamp((t - VT[i]) / VDUR[i]), ink, 0.92 * a, 2); }
    tracked(ctx, `0${cur + 1} / 04`, X + 4 * 72 + 12, 256, 13, { color: ink, alpha: 0.7 * a, track: 0.22 });
  }
}
function statusLabel(ctx, t, x, y, ink, list) {
  ctx.save(); ctx.fillStyle = ink === C.obs ? C.sandDeep : C.sand; ctx.fillRect(x, y - 9, 7, 7); ctx.restore();
  list.forEach(([s, a, b], i) => tracked(ctx, s, x + 17, y, 12, { color: ink, alpha: 0.85, track: 0.26, pin: i ? E.io(clamp((t - (a - 0.14)) / 0.3)) : seg(t, a, 0.3, E.out), pout: E.io(clamp((t - (b - 0.14)) / 0.3)) }));
}
function plinthRect(i) {
  const P = WORLD.G.plinths[i]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [dx, dz] of [[-3.6, -2.4], [3.6, -2.4], [3.6, 2.4], [-3.6, 2.4]]) { const q = proj(P.x + dx, 0.5, P.z + dz); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const lerpRect = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });
function cropMarks(ctx, r, o, L, ink, a) {
  ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = ink; ctx.lineWidth = 1.4; ctx.beginPath();
  for (const [cx, cy, dx, dy] of [[r.x, r.y, -1, -1], [r.x + r.w, r.y, 1, -1], [r.x + r.w, r.y + r.h, 1, 1], [r.x, r.y + r.h, -1, 1]]) { ctx.moveTo(cx + dx * o, cy); ctx.lineTo(cx + dx * (o + L), cy); ctx.moveTo(cx, cy + dy * o); ctx.lineTo(cx, cy + dy * (o + L)); }
  for (const mx of [r.x - o - 15, r.x + r.w + o + 15]) { const my = r.y + r.h / 2; ctx.moveTo(mx + 7, my); ctx.arc(mx, my, 7, 0, 6.2832); ctx.moveTo(mx - 13, my); ctx.lineTo(mx + 13, my); ctx.moveTo(mx, my - 13); ctx.lineTo(mx, my + 13); }
  ctx.stroke(); ctx.restore();
}

function hudGallery(ctx, t, ink) {
  // S2: what happens first
  if (t < 6.9) {
    const o1 = roll(t, 5.72), S = 92;
    rise(ctx, 'An agent or an owner', 120, 258, S, f(S, 300), ink, seg(t, 4.15, 0.8, E.out), o1);
    rise(ctx, 'submits a home.', 120, 362, S, f(S, 300, true), ink, seg(t, 4.27, 0.8, E.out), o1);
  }
  // S3: every submission carries its number
  if (t > 6.1 && t < 9.4) {
    const fade = 1 - seg(t, 8.95, 0.3, E.lin);
    for (let i = 0; i < 20; i++) {
      const a = seg(t, 6.25 + 0.02 * i, 0.4, E.lin) * (i === HERO_I ? 1 : 1 - seg(t, sinkT0(i) + 0.62, 0.5, E.lin)) * fade;
      if (a <= 0.01) continue;
      const r = plinthRect(i);
      tracked(ctx, String(i + 1).padStart(2, '0'), r.x + r.w - 1, r.y - 11, 11, { color: ink, alpha: 0.5 * a, track: 0.22, align: 'right' });
    }
  }
  // the editor's eye, moving across the plan
  if (t > 7.0 && t < 9.4) {
    let r = plinthRect(SCAN[0]);
    for (let j = 1; j < SCAN.length; j++) { const p = seg(t, SCAN_T[j], 0.14, E.out); if (p > 0) r = lerpRect(r, plinthRect(SCAN[j]), p); }
    const a = seg(t, 7.12, 0.12, E.lin) * (1 - seg(t, 8.95, 0.3, E.lin)), o = 9;
    if (a > 0) {
      ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.strokeRect(r.x - o, r.y - o, r.w + o * 2, r.h + o * 2);
      statusLabel(ctx, t, r.x - o, r.y + r.h + o + 22, ink, [['IN REVIEW', 7.14, 8.52], ['ACCEPTED', 8.52, 99]]); ctx.restore();
    }
  }
  // S4: the frame squares up; production marks arrive with it
  const al = seg(t, T_S5 - 0.85, 0.5, E.out) * (1 - seg(t, T_S5 + 0.15, 0.3, E.lin));
  if (al > 0) {
    cropMarks(ctx, { x: FR.x - 10, y: FR.y - 10, w: FR.w + 20, h: FR.h + 20 }, lerp(40, 9, al), 22, ink, al);
    const go = seg(t, T_S5 - 0.25, 0.25, E.lin);
    ctx.save(); ctx.globalAlpha *= 0.75 * (1 - go); ctx.fillStyle = C.ivory;
    for (let i = 1; i <= 2; i++) { const p1 = seg(t, T_S5 - 0.75 + i * 0.05, 0.5, E.out); ctx.fillRect(FR.x + (FR.w * i) / 3, FR.y, 1, FR.h * p1); ctx.fillRect(FR.x, FR.y + (FR.h * i) / 3, FR.w * p1, 1); }
    ctx.restore();
    tracked(ctx, 'CALIFORNIA', FR.x + FR.w - 16, FR.y + FR.h + 46, 12, { color: ink, alpha: 0.7 * al, align: 'right', track: 0.28 });
    ctx.save(); ctx.globalAlpha *= al; statusLabel(ctx, t, FR.x + 18, FR.y + FR.h + 46, ink, [['EDITED', T_S5 - 0.8, 99]]); ctx.restore();
  }
  // the exposure
  if (t >= T_S5 - 0.03 && t < T_S5 + 0.35) { const fl = 0.85 * (1 - E.out(clamp((t - (T_S5 - 0.03)) / 0.36))); ctx.fillStyle = rgba('#FFFFFF', fl); ctx.fillRect(FR.x, FR.y, FR.w, FR.h); }
  // S5 / S6: status rides with the page; channel names ride with the cards
  if (t > T_S5 + 0.95 && t < T_CA) {
    const b = PAGE.base, q = proj(b.x - PAGE.right.x * PAGE.w / 2, b.y, b.z - PAGE.right.z * PAGE.w / 2);
    // once the floor turns to glass the label steps aside, clear of the page's reflection
    const side = duskAt(t), wl = trackedW(ctx, f(12, 500, false, SANS), 'DISTRIBUTED', 12 * 0.26) + 17;
    ctx.save(); ctx.globalAlpha *= seg(t, T_S5 + 1.15, 0.4, E.lin); statusLabel(ctx, t, q[0] + lerp(4, -wl - 22, side), q[1] + lerp(34, -6, side), ink, [['PUBLISHED', T_S5 + 1.15, T_S6 + 0.3], ['DISTRIBUTED', T_S6 + 0.3, 99]]); ctx.restore();
  }
  if (t > T_S6 + 0.75) for (let k = 0; k < CHAN.length; k++) {
    const flat = CHAN[k].a < 15, L = LANE0 + (CARDS_PER - 1) * LANE_D, e = lanePoint(k, L + (flat ? 0 : 1.7)), q = proj(e[0] + (flat ? CHAN[k].w / 2 : -CHAN[k].w / 2), 0, e[1] - (flat ? CHAN[k].d / 2 + 0.55 : 0));
    const p = seg(t, T_S6 + 1.35 + k * 0.08, 0.55, E.out);
    tracked(ctx, CHAN[k].name, flat ? Math.min(q[0], 1800) : q[0], q[1] - (flat ? 0 : 2), 13, { color: ink, alpha: 0.82 * p, track: 0.26, pin: p, align: flat ? 'right' : 'left' });
  }
}
function hudMarket(ctx, t) {
  const key = t < T_NY ? 'CA' : t < T_FL ? 'NY' : 'FL', c = MK[key], t0 = key === 'CA' ? T_CA : key === 'NY' ? T_NY : T_FL;
  rise(ctx, c.name, 114, 956, 168, f(168, 300), c.ink, seg(t, t0 + 0.02, 0.75, E.out));
  tracked(ctx, c.n, 124, 790, 14, { color: c.ink, alpha: 0.66 * seg(t, t0 + 0.1, 0.5, E.lin), track: 0.3 });
  hair(ctx, 124, 808, 86 * seg(t, t0 + 0.08, 0.6, E.out), c.ink, 0.5, 1.5);
}
function hudPackages(ctx, t) {
  const ink = C.bone;
  PKG.forEach((p, i) => {
    const e = seg(t, T_PK + 0.25 + i * 0.3, 0.7, E.out);
    if (e <= 0) return;
    const q = proj(PKX[i] + (i === 3 ? 0.84 : 0), PKH + 0.55, 0), x = q[0], y = Math.min(q[1], 330);
    rise(ctx, p.name, x, y - 34, 44, f(44, 300), ink, e, 0, 'center');
    tracked(ctx, p.price, x, y, 17, { color: ink, alpha: 0.8 * e, align: 'center', track: 0.2, weight: 500 });
    if (p.rec) {
      const a = seg(t, T_PK + 1.1, 0.5, E.out), w = trackedW(ctx, f(11.5, 500, false, SANS), 'RECOMMENDED', 11.5 * 0.28) + 22;
      ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = C.sand; ctx.fillRect(x - w / 2, y - 108, w, 24); ctx.restore();
      tracked(ctx, 'RECOMMENDED', x, y - 91.5, 11.5, { color: C.obs, alpha: a, align: 'center', track: 0.28, weight: 500 });
    }
  });
  rise(ctx, 'Four exposure packages.', 120, 968, 84, f(84, 300), ink, seg(t, T_PK + 0.1, 0.8, E.out));
  tracked(ctx, 'PAID MEDIA PLACEMENT IS OFFERED SEPARATELY, FROM $250', 1800, 962, 13, { color: ink, alpha: 0.62 * seg(t, T_PK + 1.5, 0.6, E.lin), align: 'right', track: 0.24 });
}
function hudWall(ctx, t) {
  const ink = C.obs, S = 150, fR = f(S, 300), fI = f(S, 300, true), sp = S * 0.25;
  const wP = mw(ctx, fR, 'Price'), wN = mw(ctx, fI, 'never'), wE = mw(ctx, fR, 'equals'), wM = mw(ctx, fR, 'merit.');
  const ins = seg(t, T_WL + 0.3, 0.55, E.out);
  const total = wP + sp + (wN + sp) * ins + wE + sp + wM, xP = 960 - total / 2, xN = xP + wP + sp, xE = xN + (wN + sp) * ins, xM = xE + wE + sp, base = 590;
  rise(ctx, 'Price', xP, base, S, fR, ink, seg(t, T_WL - 0.02, 0.7, E.out));
  rise(ctx, 'equals', xE, base, S, fR, ink, seg(t, T_WL + 0.04, 0.7, E.out));
  rise(ctx, 'merit.', xM, base, S, fR, ink, seg(t, T_WL + 0.1, 0.7, E.out));
  rise(ctx, 'never', xN, base, S, fI, ink, seg(t, T_WL + 0.44, 0.62, E.out));
  hair(ctx, 960 - 22, 668, 44 * seg(t, T_WL + 0.62, 0.5, E.out), C.sandDeep, 1, 1.5);
  tracked(ctx, 'A HOME IS CHOSEN FOR WHAT IT IS, NOT FOR WHAT IT COSTS.', 960, 720, 16, { color: ink, alpha: 0.66 * seg(t, T_WL + 0.68, 0.5, E.lin), align: 'center', track: 0.26 });
}
const LKk = 5, LKx = 960 - 34 * 5, LKy = 232 - 5 * 5;
function hudLockup(ctx, t) {
  // the exact vector mark settles over the lit monolith, then the wordmark tracks in from wide
  const ea = seg(t, T_LK + 1.2, 0.3, E.lin);
  if (ea > 0) {
    ctx.save(); ctx.globalAlpha = ea;
    ctx.beginPath(); poly(ctx, EMB.shade.map(p => [LKx + p[0] * LKk, LKy + p[1] * LKk])); ctx.fillStyle = C.embS; ctx.fill();
    ctx.beginPath(); poly(ctx, EMB.light.map(p => [LKx + p[0] * LKk, LKy + p[1] * LKk])); ctx.fillStyle = C.embL; ctx.fill();
    ctx.restore();
  }
  const wmW = 860, wmS = wmW / LOGO.hz.w, wmX = 960 - wmW / 2, wmY = 636, mid = LOGO.hz.w / 2, spread = lerp(1.2, 1, seg(t, T_LK + 0.85, 1.1, E.out));
  LETTERS.forEach((l, i) => {
    const a = seg(t, T_LK + 0.85 + 0.03 * Math.abs(i - 6), 0.7, E.out);
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.translate(wmX, wmY + (1 - a) * 16); ctx.scale(wmS, wmS); ctx.translate((l.cx - mid) * (spread - 1), 0); ctx.fillStyle = C.bone; ctx.fill(l.p); ctx.restore();
  });
  tracked(ctx, 'A SELECTIVE REAL ESTATE MEDIA COMPANY', 960, 772, 19, { weight: 400, color: C.bone, alpha: 0.74 * seg(t, T_LK + 1.2, 0.7, E.lin), align: 'center', track: lerp(0.52, 0.36, seg(t, T_LK + 1.2, 0.9, E.out)) });
  const lw2 = 44 * seg(t, T_LK + 1.4, 0.5, E.out); hair(ctx, 960 - lw2 / 2, 816, lw2, C.sand, 0.9, 1.5);
  tracked(ctx, 'SUBMIT A HOME  ·  MATTEROFPLACE.COM', 960, 984, 15, { color: C.bone, alpha: 0.62 * seg(t, T_LK + 1.5, 0.6, E.lin), align: 'center', track: 0.34 });
}
function hud(ctx, t) {
  t = clamp(t, 0, DUR);
  ctx.setTransform(R, 0, 0, R, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, W, H);
  const ink = inkAt(t);
  if (t >= T_S2 && t < T_CA) hudGallery(ctx, t, ink);
  else if (t >= T_CA && t < T_PK) hudMarket(ctx, t);
  else if (t >= T_PK && t < T_WL) hudPackages(ctx, t);
  else if (t >= T_WL && t < T_LK) hudWall(ctx, t);
  else if (t >= T_LK) hudLockup(ctx, t);
  hudStack(ctx, t, ink); hudHead(ctx, t, ink);
  // through the door, both ways: the picture goes to light
  const wo = t < 10 ? seg(t, 3.3, 0.42, E.soft) * (1 - seg(t, T_S2 - 0.02, 0.5, E.soft)) : seg(t, T_LK - 0.28, 0.28, E.inq) * (1 - seg(t, T_LK, 0.45, E.soft));
  if (wo > 0) { ctx.fillStyle = rgba('#F7F4EE', wo); ctx.fillRect(0, 0, W, H); }
}

