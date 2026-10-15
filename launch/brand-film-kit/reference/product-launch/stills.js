// stills.js - a contact sheet of stills with their timecodes: node stills.js "0.5,2,3.1" [cols=4] [thumbW=640] [tag=sheet] [sub=1] [full]
// sub > 1 averages that many sub-frames (depth of field and soft shadows as in the export); "full" also saves each still at full size.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const times = process.argv[2].split(',').map(Number), cols = +(process.argv[3] || 4), tw = +(process.argv[4] || 640), tag = process.argv[5] || 'sheet', SUB = +(process.argv[6] || 1), full = process.argv[7] === 'full';
let ready = false;
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => { console.log('PAGEERROR', e.message); if (!ready) { console.log('the film code failed while loading: fix it and build again'); process.exit(1); } });
  page.on('console', m => { const s = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall|ReadPixels/.test(s)) console.log('console', m.type(), s.slice(0, 300)); });
  await page.goto('file://' + path.resolve('dist/dev.html'));
  await page.waitForFunction(() => window.Film && document.fonts.status === 'loaded'); ready = true;
  fs.mkdirSync('out', { recursive: true });
  const res = await page.evaluate(async ([times, cols, tw, SUB, full]) => {
    await Promise.all(Film.fonts.map(fn => document.fonts.load(fn, 'Aa')));
    const W = Film.W, H = Film.H, gl = document.getElementById('gl');
    Film.init(gl, SUB > 1 ? { keep: true, aa: false, soft: false } : { keep: true }); Film.size(W, H); Film.setRatio(1);
    const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const c = mk(W, H), x = c.getContext('2d'), h = mk(W, H), hx = h.getContext('2d'), th = Math.round(tw * H / W), rows = Math.ceil(times.length / cols), sheet = mk(cols * tw, rows * th), sx = sheet.getContext('2d');
    const hal = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
    sx.fillStyle = '#333'; sx.fillRect(0, 0, sheet.width, sheet.height); const fulls = [];
    times.forEach((t, n) => {
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over';
      for (let i = 0; i < SUB; i++) {
        if (SUB > 1) { const a = hal(i + 1, 5) * 6.2832, r = Math.sqrt(hal(i + 1, 7)), la = hal(i + 1, 11) * 6.2832, lr = Math.sqrt(hal(i + 1, 13)) * 0.022; Film.setJitter({ x: hal(i + 1, 2) - 0.5, y: hal(i + 1, 3) - 0.5, ax: Math.cos(a) * r, ay: Math.sin(a) * r, lx: Math.cos(la) * lr, lz: Math.sin(la) * lr, u: hal(i + 1, 19) * 2 - 1, v: hal(i + 1, 29) * 2 - 1, w: hal(i + 1, 23), i }); }
        Film.render(t); x.globalAlpha = 1 / (i + 1); x.drawImage(gl, 0, 0);
      }
      Film.setJitter({}); x.globalAlpha = 1; Film.hud(hx, t); x.drawImage(h, 0, 0); if (Film.finish) Film.finish(x, t);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      if (full) fulls.push([t, c.toDataURL('image/png').split(',')[1]]);
      x.fillStyle = 'rgba(0,0,0,0.75)'; x.fillRect(0, H - 44, 150, 44); x.fillStyle = '#fff'; x.font = '600 30px monospace'; x.textBaseline = 'alphabetic'; x.fillText(t.toFixed(2), 10, H - 10);
      sx.drawImage(c, (n % cols) * tw, Math.floor(n / cols) * th, tw, th);
    });
    return { sheet: sheet.toDataURL('image/jpeg', 0.88).split(',')[1], fulls, size: [sheet.width, sheet.height] };
  }, [times, cols, tw, SUB, full]);
  fs.writeFileSync(`out/${tag}.jpg`, Buffer.from(res.sheet, 'base64'));
  for (const [t, b] of res.fulls) fs.writeFileSync(`out/${tag}_${t.toFixed(2)}.png`, Buffer.from(b, 'base64'));
  console.log('wrote', `out/${tag}.jpg`, res.size.join(' x '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
