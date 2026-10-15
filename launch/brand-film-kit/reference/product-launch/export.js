// export.js - render frames: node export.js [fps=60] [from=0] [to=all] [worker=0] [workers=1] [outdir=frames]
// Every frame is the average of several sub-frames, each drawn at a slightly different moment inside the shutter, sub-pixel offset,
// point on the lens and point on the light. Averaged in linear light, that gives motion blur, anti-aliasing, depth of field and soft
// shadows at once. Titles are accumulated separately and laid over the result. Frames already on disk are skipped, so a stopped run resumes.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FPS = +(process.argv[2] || 60), FROM = +(process.argv[3] || 0), TO = process.argv[4] ? +process.argv[4] : Infinity, WK = +(process.argv[5] || 0), WKS = +(process.argv[6] || 1), OUT = process.argv[7] || 'frames';
let ready = false;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // no GPU in this workspace: SwiftShader draws WebGL on the CPU. With a real GPU, drop the args.
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', e => { console.log('PAGEERROR', e.message); if (!ready) { console.log('the film code failed while loading: fix it and build again'); process.exit(1); } });
  page.on('console', m => { const s = m.text(); if (m.type() === 'error' && !/GPU stall|ReadPixels/.test(s)) console.log('console error', s.slice(0, 300)); });
  await page.goto('file://' + path.resolve(process.env.FILM_PAGE || 'dist/dev.html'));
  await page.waitForFunction(() => window.Film && document.fonts.status === 'loaded'); ready = true;
  const DUR = await page.evaluate(async (FPS) => {
    await Promise.all(Film.fonts.map(fn => document.fonts.load(fn, 'Aa')));           // type must be loaded before anything is measured or drawn
    const W = Film.W, H = Film.H, glc = document.getElementById('gl');
    Film.init(glc, { keep: true, aa: false, soft: false, lean: true });              // the averaging does the anti-aliasing and the soft shadows; lean = layered effects may draw fewer layers per sub-frame
    Film.size(W, H); Film.setRatio(1);
    const gl = glc.getContext('webgl2') || glc.getContext('webgl');
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const hud = mk(), hx = hud.getContext('2d', { willReadFrequently: true }), acc = mk(), ax = acc.getContext('2d', { willReadFrequently: true });
    const px = new Uint8Array(W * H * 4), sum = new Float32Array(W * H * 3), hs = new Float32Array(W * H * 4), img = ax.createImageData(W, H);
    const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    const ENC = new Float32Array(4097); for (let i = 0; i <= 4096; i++) { const v = i / 4096; ENC[i] = 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
    const hal = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };      // low-discrepancy sequence
    const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    const DTH = new Float32Array(4096); for (let i = 0; i < 4096; i++) DTH[i] = hash(i * 1.37 + 5);
    const CUTS = Film.cuts || [];
    window.__frame = (k) => {
      const t = k / FPS, shutter = 0.5 / FPS;                                         // a 180-degree shutter that opens at t
      Film.setJitter({}); Film.update(t);
      const N = Film.samplesAt ? Film.samplesAt() : 8;
      sum.fill(0); hs.fill(0);
      const r1 = hash(k * 3.1 + 1), r2 = hash(k * 5.3 + 2), r3 = hash(k * 7.7 + 3), r4 = hash(k * 9.1 + 4);      // a different rotation of every sequence on every frame: patterns become fine noise
      for (let i = 0; i < N; i++) {
        let ti = t + ((i + (hal(i + 1, 17) + r1) % 1) / N) * shutter;
        for (const c of CUTS) if ((t < c) !== (ti < c)) ti = t < c ? c - 1e-4 : c;   // a sub-frame never crosses a hard cut: no blended frame at the cut
        ti = Math.min(Film.DUR, Math.max(0, ti));
        const la = ((hal(i + 1, 5) + r2) % 1) * 6.2832, lr = Math.sqrt(hal(i + 1, 7)), sa = ((hal(i + 1, 11) + r3) % 1) * 6.2832, sr = Math.sqrt(hal(i + 1, 13)) * 0.022;
        Film.setJitter({ x: hal(i + 1, 2) - 0.5, y: hal(i + 1, 3) - 0.5, ax: Math.cos(la) * lr, ay: Math.sin(la) * lr, lx: Math.cos(sa) * sr, lz: Math.sin(sa) * sr, u: ((hal(i + 1, 19) + r4) % 1) * 2 - 1, v: ((hal(i + 1, 29) + r2) % 1) * 2 - 1, w: (hal(i + 1, 23) + r1) % 1, i: i + k });
        Film.render(ti);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let p = 0, q = 0; p < px.length; p += 4, q += 3) { sum[q] += LUT[px[p]]; sum[q + 1] += LUT[px[p + 1]]; sum[q + 2] += LUT[px[p + 2]]; }
        Film.hud(hx, ti);
        const hd = hx.getImageData(0, 0, W, H).data;
        for (let p = 0; p < hd.length; p += 4) { const a = hd[p + 3]; if (a) { hs[p] += hd[p] * a; hs[p + 1] += hd[p + 1] * a; hs[p + 2] += hd[p + 2] * a; hs[p + 3] += a; } }
      }
      Film.setJitter({});
      const o = img.data, kN = 4096 / N, kH = 1 / (255 * N);                          // resolve: picture back to display values, titles over it, dither before rounding
      for (let y = 0; y < H; y++) {
        const src = (H - 1 - y) * W * 3, dst = y * W * 4;                             // readPixels rows run bottom-up
        for (let x = 0; x < W; x++) {
          const q = src + x * 3, p = dst + x * 4, A = hs[p + 3] * kH, d = DTH[((y & 63) << 6) | (x & 63)] - 0.5;
          o[p] = ENC[Math.min(4096, (sum[q] * kN + 0.5) | 0)] * (1 - A) + hs[p] * kH + 0.5 + d;
          o[p + 1] = ENC[Math.min(4096, (sum[q + 1] * kN + 0.5) | 0)] * (1 - A) + hs[p + 1] * kH + 0.5 + d;
          o[p + 2] = ENC[Math.min(4096, (sum[q + 2] * kN + 0.5) | 0)] * (1 - A) + hs[p + 2] * kH + 0.5 + d; o[p + 3] = 255;
        }
      }
      ax.putImageData(img, 0, 0);
      if (Film.finish) Film.finish(ax, t);
      return [N, acc.toDataURL('image/jpeg', 1.0).split(',')[1]];                     // quality 1.0 keeps full chroma; PNG encoding is several times slower
    };
    return Film.DUR;
  }, FPS);
  const t0 = Date.now(), last = Math.min(TO, Math.round(DUR * FPS)); let done = 0, samples = 0;
  for (let k = FROM; k < last; k++) {
    if (k % WKS !== WK) continue;
    const file = `${OUT}/${String(k).padStart(5, '0')}.jpg`;
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
    const [n, b64] = await page.evaluate(k => window.__frame(k), k);
    fs.writeFileSync(file + '.tmp', Buffer.from(b64, 'base64')); fs.renameSync(file + '.tmp', file);
    done++; samples += n;
    if (done % 10 === 0) console.log(`w${WK}: frame ${k}, ${done} done, ${((Date.now() - t0) / 1000).toFixed(0)}s, ${((Date.now() - t0) / samples).toFixed(0)} ms per sub-frame`);
  }
  console.log(`w${WK}: finished ${done} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
