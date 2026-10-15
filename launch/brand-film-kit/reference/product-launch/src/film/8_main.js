/* ---------- finishing, for export: vignette and grain baked in ---------- */
function vignette(t) {
  let light = 0;
  if (t >= T_S2 && t < T_CA) light = seg(t, T_S2, 0.5, E.lin) * (1 - duskAt(t));
  else if (t >= T_CA && t < T_NY) light = 0.55; else if (t >= T_FL && t < T_PK) light = 1; else if (t >= T_WL && t < T_LK) light = 1;
  return lerp(0.26, 0.05, light);
}
let grainC = null;
function grainTile() {
  if (grainC) return grainC;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'), im = x.createImageData(256, 256), rnd = lcg(20261002);
  for (let i = 0; i < 256 * 256; i++) { const v = Math.round(128 + (rnd() + rnd() + rnd() - 1.5) * 92); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = clamp(v, 0, 255); im.data[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0);
  return (grainC = c);
}
const grainShift = t => { const n = Math.floor(t * 24); return [hash(n) * 256, hash(n + 91) * 256]; };
function finish(ctx, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  const vg = ctx.createRadialGradient(960, 540, 480, 960, 540, 1200); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${vignette(t)})`);
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const gs = grainShift(t), pat = ctx.createPattern(grainTile(), 'repeat');
  if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().translate(gs[0], gs[1]).scale(1.5));
  ctx.save(); ctx.fillStyle = pat;
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.1; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.02; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function init(canvas, o = {}) {                 // o.keep, o.aa, o.soft, o.lean, o.shadow: see OPT. Called after the fonts have loaded
  Object.assign(OPT, o); MC.clear();
  renderer = new T.WebGLRenderer({ canvas, antialias: OPT.aa, preserveDrawingBuffer: !!OPT.keep, powerPreference: 'high-performance' });
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.localClippingEnabled = true; renderer.shadowMap.enabled = true; renderer.shadowMap.type = OPT.soft ? T.PCFSoftShadowMap : T.BasicShadowMap;
  cam = new T.PerspectiveCamera(30, 16 / 9, 0.3, 4000);
  GLOW.tex = glowTexture(256, 2.2); GLOW.soft = glowTexture(64, 1.6);
  WORLD.G = buildGallery(); WORLD.H = buildHall();
  WORLD.CA = buildMarket('CA'); WORLD.NY = buildMarket('NY'); WORLD.FL = buildMarket('FL');
  WORLD.PK = buildPackages(); WORLD.WL = buildWall();
}
function render(t) { update(t); drawWorld(ACTIVE); }
// how many sub-frames the exporter should average at time t: more where the lens is wide open
const samplesAt = () => (CS.ap >= 0.085 ? 16 : CS.ap > 0 ? 8 : 6);       // at 60 frames a second
const Launch = { W, H, DUR, init, render, update, hud, finish, vignette, grainTile, grainShift, samplesAt,
  setRatio: r => { R = r; },
  setJitter: j => Object.assign(JIT, { x: 0, y: 0, lx: 0, lz: 0, ax: 0, ay: 0, u: 0, v: 0, w: 0.5, i: 0 }, j),     // see JIT in 0_core.js
  cuts: [T_CA, T_NY, T_FL, T_PK, T_WL],          // the hard cuts: every other shot change is a continuous move
  shots: [[0, 'The door', 'Not every home is accepted.'], [T_S2, 'Submissions', 'A low glide over the plinths.'], [T_S3, 'Curate', 'Seen in plan. One is kept; the rest become drawings.'], [T_S4, 'Frame', 'An orbit that ends in the photograph.'], [T_S5, 'Publish', 'The photograph becomes a page.'],
    [T_S6, 'Distribute', 'Four lanes of cards, at nightfall.'], [T_CA, 'Markets', 'California, New York, Florida.'], [T_PK, 'Packages', 'Four, paid only after acceptance.'], [T_WL, 'Principle', 'Price never equals merit.'], [T_LK, 'Lockup', 'The door becomes the mark.']],
  resetMeasure: () => MC.clear(), size: (w, h) => renderer.setSize(w, h, false), lost: () => { WORLD.G.printed = false; },
  _dbg: () => ({ WORLD, cam, renderer, CS, PAGE, PIC, DF, proj, rawRender: () => drawWorld(ACTIVE) }),
  fonts: ['300 100px "MoP Serif"', 'italic 300 100px "MoP Serif"', '400 40px "MoP Serif"', 'italic 400 40px "MoP Serif"', '500 20px "MoP Sans"', '400 20px "MoP Sans"'] };
const Film = Launch;                             // the name the kit's tools look for
