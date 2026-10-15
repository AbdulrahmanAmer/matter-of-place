// make-player.js - the whole film in one HTML file, with the final soundtrack:  node make-player.js   (after npm run build)
// Takes dist/page_test.html (the player with three.js inlined), puts the soundtrack with the voice-over inside it,
// and has the Sound button play that soundtrack instead of the synthesized music. Writes matter-of-place-product-launch.html.
const fs = require('fs');
const src = fs.readFileSync('dist/page_test.html', 'utf8');
let body = src.slice(src.indexOf('<body>') + 6, src.lastIndexOf('</body>'));
const take = re => { const m = body.match(re); if (!m) throw new Error('not found: ' + re); body = body.replace(m[0], () => ''); return m[0]; };
take(/<title>[\s\S]*?<\/title>/); const style = take(/<style>[\s\S]*?<\/style>/);
const sub1 = (a, b) => { if (body.split(a).length !== 2) throw new Error('expected once: ' + a.slice(0, 60)); body = body.replace(a, () => b); };
sub1('if (!buf) buf = await Score.render(ac.sampleRate);',
     'if (!buf) buf = window.SOUNDTRACK_MP3 ? await ac.decodeAudioData(Uint8Array.from(atob(window.SOUNDTRACK_MP3), c => c.charCodeAt(0)).buffer) : await Score.render(ac.sampleRate);');
sub1('<p class="caps">Matter of Place · 30 seconds · 16:9</p>', '<p class="caps">Matter of Place · 30 seconds · 16:9 · with voice-over</p>');
sub1('Space plays and pauses, the bar scrubs, and the sound is off until you turn it on.',
     'Space plays and pauses, the bar scrubs, and the sound, the final soundtrack with the voice-over, is off until you turn it on.');
const mp3 = fs.readFileSync('sound/matter-of-place-soundtrack.mp3').toString('base64');
const at = body.indexOf('<script>\nif (!window.THREE)') >= 0 ? body.indexOf('<script>\nif (!window.THREE)') : body.indexOf('<script>if (!window.THREE)');
if (at < 0) throw new Error('player script not found');
body = body.slice(0, at) + '<script>window.SOUNDTRACK_MP3 = "' + mp3 + '";</script>\n' + body.slice(at);
const doc = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  + '<title>Product Launch · Matter of Place</title>\n' + style + '\n</head>\n<body>\n' + body.trim() + '\n</body>\n</html>\n';
fs.writeFileSync('matter-of-place-product-launch.html', doc);
console.log('wrote matter-of-place-product-launch.html,', (Buffer.byteLength(doc) / 1e6).toFixed(2), 'MB');
