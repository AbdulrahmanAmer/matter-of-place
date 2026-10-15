// pagetest.js - exercise the player page: node pagetest.js   (uses dist/page_test.html, the copy with three.js inlined)
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; const open = async (opts) => { const ctx = await browser.newContext(opts), page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { const s = m.text(); if (m.type() === 'error' && !/GPU stall|ReadPixels/.test(s)) errs.push(s.slice(0, 200)); });
    await page.goto('file://' + path.resolve('dist/page_test.html')); await page.waitForFunction(() => window.film, null, { timeout: 30000 }); return page; };
  const page = await open({ viewport: { width: 1280, height: 900 } }), T = () => page.evaluate(() => window.film.time);
  await page.waitForTimeout(1500); const t1 = await T();
  await page.click('#sound'); await page.waitForFunction(() => /Sound on|No sound/.test(document.getElementById('sound').textContent), null, { timeout: 30000 }); const snd = await page.textContent('#sound');
  await page.click('#shots li:last-child button'); await page.waitForTimeout(600); const t2 = await T();
  await page.click('#play'); const t3 = await T(); await page.waitForTimeout(300); const t4 = await T();
  // the live 3D picture itself, in the middle of the film: is anything being drawn?
  const mid = await page.evaluate(() => { const tm = window.film.duration * 0.3; window.film.seek(tm); Film.render(tm); const g = document.getElementById('gl'), c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(g, 0, 0, 64, 36);      // read in the same task as the draw, before the browser clears the buffer
    const d = x.getImageData(0, 0, 64, 36).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); } return hi - lo; });
  await page.screenshot({ path: 'out/page.png', fullPage: true });
  const phone = await open({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' }); await phone.waitForTimeout(600);
  const ph = await phone.evaluate(() => ({ t: window.film.time, sideways: document.documentElement.scrollWidth > window.innerWidth })); await phone.screenshot({ path: 'out/page_phone.png', fullPage: true });
  console.log(JSON.stringify({ autoplayAdvanced: t1 > 0.5, sound: snd, afterLastShotClick: +t2.toFixed(2), pausedHolds: Math.abs(t4 - t3) < 0.001, live3dContrast: mid, phoneReducedMotionHoldsAt: +ph.t.toFixed(2), phoneScrollsSideways: ph.sideways, errors: errs }));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
