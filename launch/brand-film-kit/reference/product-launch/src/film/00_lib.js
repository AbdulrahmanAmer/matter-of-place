/* Shared helpers: easing, colour, type on a 2D canvas. */
const W = 1920, H = 1080, DUR = 30;
let R = 1; // HUD device pixels per stage pixel

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, p) => a + (b - a) * p;
function bez(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = u => ((ax * u + bx) * u + cx) * u, fy = u => ((ay * u + by) * u + cy) * u;
  return x => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 30; i++) { const e = fx(u) - x; if (Math.abs(e) < 1e-6) break; if (e > 0) hi = u; else lo = u; u = (lo + hi) / 2; }
    return fy(u);
  };
}
const E = {
  lin: x => x,
  out: bez(0.16, 1, 0.3, 1),
  io: bez(0.76, 0, 0.24, 1),
  ioS: bez(0.65, 0, 0.35, 1),
  inq: bez(0.5, 0, 0.75, 0),
  soft: bez(0.4, 0, 0.2, 1),
  door: bez(0.6, 0, 0.1, 1),
  push: bez(0.66, 0, 0.22, 1),
  roll: bez(0.7, 0, 0.2, 1),
  sine: x => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x))
};
const seg = (t, t0, d, e = E.out) => e(clamp((t - t0) / d));

const C = { obs: '#11110F', obs2: '#191917', bone: '#EEEAE1', ivory: '#F6F3EC', sand: '#C6B8A0', sandDeep: '#8C7D63', embL: '#D8D4CC', embS: '#696863' };
const HX = new Map();
const hex = h => { if (h[0] !== '#') return h.match(/[\d.]+/g).slice(0, 3).map(Number); let c = HX.get(h); if (!c) { c = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; HX.set(h, c); } return c; };
const rgba = (h, a) => { const c = hex(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
const mixHex = (a, b, p) => { const A = hex(a), B = hex(b); return `rgb(${Math.round(lerp(A[0], B[0], p))},${Math.round(lerp(A[1], B[1], p))},${Math.round(lerp(A[2], B[2], p))})`; };

const SERIF = '"MoP Serif", Georgia, "Times New Roman", serif';
const SANS = '"MoP Sans", "Helvetica Neue", Arial, sans-serif';
const f = (size, weight = 300, italic = false, fam = SERIF) => `${italic ? 'italic ' : ''}${weight} ${size}px ${fam}`;
const MC = new Map();
function mw(ctx, font, str) { const k = font + '|' + str; let w = MC.get(k); if (w === undefined) { ctx.font = font; w = ctx.measureText(str).width; MC.set(k, w); } return w; }

// A line that rises into a mask (pin 0→1) and leaves through its top (pout 0→1).
function rise(ctx, str, x, base, size, font, color, pin, pout = 0, align = 'left') {
  if (pin <= 0 || pout >= 1) return;
  const w = mw(ctx, font, str);
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const asc = size * 0.82, hgt = size * 1.14, pad = size * 0.22;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0 - pad, base - asc, w + pad * 2, hgt); ctx.clip();
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x0, base + (1 - pin) * hgt - pout * hgt);
  ctx.restore();
}
function trackedW(ctx, font, str, tr) { let w = 0; for (const ch of str) w += mw(ctx, font, ch) + tr; return w - tr; }
// Letter-spaced capitals, drawn glyph by glyph so tracking is identical in every browser.
function tracked(ctx, str, x, y, size, o = {}) {
  const { weight = 500, track = 0.28, align = 'left', color = '#000', alpha = 1, pin = 1, pout = 0 } = o;
  if (alpha <= 0 || pin <= 0 || pout >= 1) return 0;
  const font = f(size, weight, false, SANS), tr = size * track, w = trackedW(ctx, font, str, tr);
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  ctx.save(); ctx.globalAlpha *= alpha;
  let dy = 0;
  if (pin < 1 || pout > 0) { const hgt = size * 1.7; ctx.beginPath(); ctx.rect(cx - 6, y - size * 1.15, w + 12, hgt); ctx.clip(); dy = (1 - pin) * hgt - pout * hgt; }
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  for (const ch of str) { ctx.fillText(ch, cx, y + dy); cx += mw(ctx, font, ch) + tr; }
  ctx.restore();
  return w;
}
function poly(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function hair(ctx, x, y, w, color, alpha, th = 1) { if (w <= 0 || alpha <= 0) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = color; ctx.fillRect(x, y, w, th); ctx.restore(); }
const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const lcg = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
