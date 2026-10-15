// build.js - assemble the film: node build.js   ->  dist/dev.html (offline, for stills and export) and, if src/page.html exists, dist/page.html
const fs = require('fs'), vm = require('vm');
const rd = f => fs.readFileSync('src/' + f, 'utf8');
// the film is src/film.js, or every .js in src/film/ in name order once it has been split (0_core.js, 1_hall.js, ... 9_main.js)
const parts = fs.existsSync('src/film') ? fs.readdirSync('src/film').filter(f => f.endsWith('.js')).sort().map(f => 'film/' + f) : ['film.js'];
if (fs.existsSync('src/score.js')) parts.push('score.js');
const logo = fs.existsSync('logo.json') ? fs.readFileSync('logo.json', 'utf8') : 'null';              // written by logo.js from the supplied SVG
const js = parts.map(rd).join('\n\n').replace('__LOGO__', () => logo);
try { new vm.Script(js, { filename: 'film (all parts joined)' }); } catch (e) { console.error('SYNTAX ERROR in the film code:', e.message, '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')); process.exit(1); }
const fonts = fs.existsSync('fonts/fonts.json') ? JSON.parse(fs.readFileSync('fonts/fonts.json', 'utf8')) : {};   // { "Film Serif|normal|200 500": "<base64 woff2>", ... }
const fontCss = Object.entries(fonts).map(([k, b64]) => { const [fam, style, weight] = k.split('|'); return `@font-face{font-family:"${fam}";font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format("woff2")}`; }).join('\n');
const three = fs.readFileSync(require.resolve('three/build/three.min.js'), 'utf8');      // inlined so headless rendering needs no network
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/dev.html', `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss} body{margin:0;background:#222}</style></head><body><canvas id="gl" width="1920" height="1080"></canvas><script>${three}</script><script>${js}\nwindow.Film = Film; if (typeof Score !== 'undefined') window.Score = Score;</script></body></html>`);
if (fs.existsSync('src/page.html')) {
  let page = rd('page.html'); const rep = (k, v) => { if (!page.includes(k)) throw new Error('missing ' + k); page = page.replace(k, () => v); };
  rep('/*__FONTS__*/', fontCss); rep('__FILM_JS__', js);
  fs.writeFileSync('dist/page.html', page);                                             // the page to publish: it loads three.js from cdnjs
  // the same page with three.js inlined: the one to test here (the workspace cannot reach cdnjs) and the one to send as a file if it must work offline
  fs.writeFileSync('dist/page_test.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${page.replace(/<script src="https:\/\/cdnjs[^"]*three[^"]*"><\/script>/, () => '<script>' + three + '</script>')}</body></html>`);
}
console.log('built', parts.length, 'file(s),', (js.length / 1024).toFixed(1) + ' KB of film code');
