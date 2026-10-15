// logo.js - take a logo SVG apart so its pieces can move:  node logo.js logo.svg   ->  logo.json
// Every <path> keeps its fill and fill rule and is split into pieces: sub-paths that overlap sideways are grouped, so for a wordmark set
// as outlines in one row the pieces are its letters, left to right. Draw `d` for the logo exactly as supplied; animate with `pieces`.
// Shapes other than <path> (circle, rect, text) must be converted to paths first; a stacked wordmark needs its rows separated by hand.
const fs = require('fs');
const svg = fs.readFileSync(process.argv[2], 'utf8'), vb = (svg.match(/viewBox="([^"]+)"/) || [0, '0 0 100 100'])[1].split(/[\s,]+/).map(Number);
function walk(d, cur) {                           // one closed sub-path: its x-range (control points included), its start point, and itself with an absolute first move
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || []; let x = cur[0], y = cur[1], x0 = Infinity, x1 = -Infinity, i = 0, cmd = 'M', start = null;
  const num = () => parseFloat(tok[i++]), see = v => { x0 = Math.min(x0, v); x1 = Math.max(x1, v); };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(); if (C === 'Z') continue;
    if (C === 'H') { x = num() + (rel ? x : 0); see(x); } else if (C === 'V') { y = num() + (rel ? y : 0); }
    else if (C === 'A') { const rx = num(); i += 4; x = num() + (rel ? x : 0); y = num() + (rel ? y : 0); see(x - rx); see(x + rx); }
    else { const pairs = { M: 1, L: 1, T: 1, Q: 2, S: 2, C: 3 }[C] || 1;
      for (let k = 0; k < pairs; k++) { const px = num() + (rel ? x : 0), py = num() + (rel ? y : 0); see(px); if (k === pairs - 1) { x = px; y = py; } }
      if (C === 'M') { if (!start) start = [x, y]; cmd = rel ? 'l' : 'L'; } }
  }
  return { x0, x1, start, d: d.replace(/^\s*[mM]\s*-?\d*\.?\d+(?:e-?\d+)?[\s,]*-?\d*\.?\d+(?:e-?\d+)?/, 'M' + start[0] + ' ' + start[1]) };
}
const paths = [...svg.matchAll(/<path\b[^>]*>/g)].map(m => {
  const tag = m[0], at = k => (tag.match(new RegExp('\\b' + k + '="([^"]*)"')) || [])[1]; let cur = [0, 0];
  const subs = at('d').split(/(?<=[Zz])/).map(s => s.trim()).filter(Boolean).map(d => { const w = walk(d, cur); cur = w.start; return w; }).sort((a, b) => a.x0 - b.x0), pieces = [];
  for (const s of subs) { const l = pieces[pieces.length - 1]; if (l && s.x0 < l.x1 - 0.5) { l.d += ' ' + s.d; l.x1 = Math.max(l.x1, s.x1); } else pieces.push({ d: s.d, x0: s.x0, x1: s.x1 }); }
  return { d: at('d'), fill: at('fill') || '#000', rule: at('fill-rule') || 'nonzero', pieces: pieces.map(p => ({ d: p.d, x0: +p.x0.toFixed(2), x1: +p.x1.toFixed(2) })) };
});
fs.writeFileSync('logo.json', JSON.stringify({ x: vb[0], y: vb[1], w: vb[2], h: vb[3], paths }));
paths.forEach((p, i) => console.log('path', i, p.fill, p.rule, p.pieces.length, 'piece(s):', p.pieces.map(q => q.x0 + '-' + q.x1).join('  ')));
