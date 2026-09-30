// Offline sound design from a cue list. Noise, filters and envelopes only (MOTION-BIBLE §3): no oscillators,
// so no pitched sustained tone, chord, melody or loop can exist in the output. Deterministic: seeded noise.
//
// cues.json: { "duration": s, "sampleRate": 48000, "cues": [ { "t": s, "type": "...", ...params } ] }
// Beds (have "end"): air, room, wind, water, city.   One-shots: step, door, paper, fabric, whoosh, impact.
// Levels are relative dB; loudness is set once, at encode (engine/encode.mjs).

const db = (d) => Math.pow(10, d / 20);

function rng(seed) { // xorshift32
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 * 2 - 1; };
}
function white(n, seed) { const r = rng(seed), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r(); return a; }
function pink(n, seed) { // Paul Kellet, refined
  const r = rng(seed), a = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return a;
}
function brown(n, seed) { const r = rng(seed), a = new Float32Array(n); let l = 0; for (let i = 0; i < n; i++) { l = (l + 0.02 * r()) / 1.02; a[i] = l * 3.5; } return a; }
const GEN = { white, pink, brown };

export async function renderCues(spec) {
  const sr = spec.sampleRate || 48000;
  const len = Math.ceil(spec.duration * sr);
  const ctx = new OfflineAudioContext(2, len, sr);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  let seed = 7;

  const buffer = (chans) => { const b = ctx.createBuffer(chans.length, chans[0].length, sr); chans.forEach((c, i) => b.copyToChannel(c, i)); return b; };
  const filt = (type, freq, Q = 0.707) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q; return f; };
  const chain = (src, nodes, out) => { let n = src; for (const x of nodes) { n.connect(x); n = x; } n.connect(out); };

  // envelope curve for a bed: fades, slow LFO (wind), swells (water), gusts; 100 points per second
  const bedCurve = (c) => {
    const n = Math.max(2, Math.ceil((c.end - c.t) * 100));
    const a = new Float32Array(n);
    const phase = (c.seed || 1) * 1.7;
    for (let i = 0; i < n; i++) {
      const s = i / 100;
      let g = 1;
      if (c.fadeIn) g *= Math.min(1, s / c.fadeIn) ** 2;
      if (c.fadeOut) g *= Math.min(1, (c.end - c.t - s) / c.fadeOut) ** 1.5;
      if (c.lfo) g *= db(c.lfoDepth ?? 4) ** Math.sin(2 * Math.PI * c.lfo * s + phase);
      if (c.swell) g *= db(c.swellDepth ?? 6) ** (0.5 * Math.sin(2 * Math.PI * s / c.swell + phase) + 0.5 * Math.sin(2 * Math.PI * s / (c.swell * 1.37) + 2 * phase));
      for (const gt of c.gusts || []) { const d = (c.t + s - gt) / 0.7; g *= db(5) ** Math.exp(-d * d); }
      a[i] = Math.max(0, g) * db(c.db);
    }
    return a;
  };

  const bed = (c, color, filters) => {
    const n = Math.ceil((c.end - c.t) * sr) + 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer([GEN[color](n, seed++), GEN[color](n, seed++)]); // decorrelated L/R
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(bedCurve(c), c.t, c.end - c.t);
    chain(src, [...filters, g], master);
    src.start(c.t);
    return g;
  };

  // one-shot: a noise burst with a sample-accurate envelope baked in, then filters, then pan
  const shot = (c, color, ms, env, filters, pan = 0, level = 0) => {
    const n = Math.ceil((ms / 1000) * sr);
    const x = GEN[color](n, seed++);
    for (let i = 0; i < n; i++) x[i] *= env(i / sr);
    const src = ctx.createBufferSource();
    src.buffer = buffer([x]);
    const g = ctx.createGain();
    g.gain.value = db(c.db + level);
    const p = ctx.createStereoPanner();
    if (Array.isArray(pan)) { p.pan.setValueAtTime(pan[0], c.t); p.pan.linearRampToValueAtTime(pan[1], c.t + ms / 1000); } else p.pan.value = pan;
    chain(src, [...filters, g, p], master);
    src.start(c.t);
    return { src, filters };
  };
  const ad = (att, tau) => (s) => (s < att ? s / att : Math.exp(-(s - att) / tau));

  for (const c of spec.cues) {
    switch (c.type) {
      case "air": bed(c, "white", [filt("highpass", 60), filt("lowpass", 14000)]); break;
      case "room": bed(c, "brown", [filt("lowpass", 120), filt("lowpass", 120)]); break;
      case "wind":
        bed(c, "pink", [filt("highpass", c.lo || 300), filt("lowpass", c.hi || 1200)]);
        bed({ ...c, db: c.db - (c.rustle ?? 11), seed: (c.seed || 1) + 11 }, "pink", [filt("highpass", 2500)]); // leaves: the broadband edge of wind
        break;
      case "water": {
        bed(c, "brown", [filt("lowpass", 700), filt("highpass", 40)]);
        bed({ ...c, db: c.db - 5, swell: (c.swell || 7) * 1.31, seed: (c.seed || 1) + 3 }, "pink", [filt("highpass", 1200)]); // foam
        break;
      }
      case "city": {
        bed(c, "brown", [filt("lowpass", 260), filt("highpass", 30)]);
        bed({ ...c, db: c.db - 6, seed: (c.seed || 1) + 5 }, "pink", [filt("highpass", 400)]); // distant traffic haze
        break;
      }
      case "step": // 40 ms stone footstep
        shot(c, "white", 90, ad(0.002, 0.014), [filt("lowpass", 400), filt("highpass", 45)], c.pan || 0);
        shot(c, "white", 30, ad(0.0005, 0.004), [filt("highpass", 2500)], c.pan || 0, -22); // grit of the sole
        break;
      case "door": // 80 ms wooden thud and a soft hinge tail, all filtered noise
        shot(c, "white", 260, ad(0.003, 0.03), [filt("lowpass", 190), filt("lowpass", 190), filt("highpass", 35)]);
        shot(c, "pink", 160, ad(0.002, 0.025), [filt("bandpass", 700, 0.9)], 0, -14);
        shot({ ...c, t: c.t + 0.06 }, "pink", 700, (s) => Math.sin(Math.min(1, s / 0.7) * Math.PI) ** 2 * 0.5, [filt("bandpass", 2200, 1.4), filt("highpass", 900)], 0.15, -27);
        break;
      case "paper": { // high-passed crackle: sparse impulses under a swell
        const ms = (c.dur || 0.6) * 1000, n = Math.ceil((ms / 1000) * sr), r = rng(seed++), x = new Float32Array(n);
        for (let i = 0; i < n; i++) { const s = i / sr, e = Math.sin(Math.PI * Math.min(1, s / (ms / 1000))) ** 1.5; x[i] = (Math.abs(r()) > 0.985 ? r() : r() * 0.08) * e; }
        const src = ctx.createBufferSource(); src.buffer = buffer([x]);
        const g = ctx.createGain(); g.gain.value = db(c.db);
        chain(src, [filt("highpass", 3000), filt("highpass", 3000), filt("lowpass", 11000), g], master); src.start(c.t);
        break;
      }
      case "fabric": { // soft swish
        const dur = c.dur || 0.5;
        shot(c, "pink", dur * 1000, (s) => Math.sin(Math.PI * Math.min(1, s / dur)) ** 2, [filt("bandpass", 1400, 0.6), filt("lowpass", 4000)], c.pan || 0);
        break;
      }
      case "whoosh": { // 200 ms noise sweep, band-pass rising 200 to 4000 Hz
        const dur = c.dur || 0.2;
        const bp = filt("bandpass", 200, 1.1);
        bp.frequency.setValueAtTime(200, c.t);
        bp.frequency.exponentialRampToValueAtTime(4000, c.t + dur);
        shot(c, "pink", dur * 1000 + 60, (s) => Math.sin(Math.PI * Math.min(1, s / (dur + 0.06))) ** 1.6, [bp, filt("highpass", 120)], c.pan ?? [-0.4, 0.4]);
        break;
      }
      case "impact": // one low non-pitched thump under 80 Hz, 120 ms
        shot(c, "white", 420, ad(0.004, 0.05), [filt("lowpass", 80), filt("lowpass", 80), filt("lowpass", 80), filt("highpass", 22)]);
        shot(c, "white", 120, ad(0.002, 0.02), [filt("lowpass", 300), filt("highpass", 80)], 0, -12);
        break;
      default: throw new Error("unknown cue type " + c.type);
    }
  }
  return ctx.startRendering();
}

// 32-bit float WAV, base64 (float so nothing clips before loudness is set at encode)
export function wavBase64(buf) {
  const ch = buf.numberOfChannels, n = buf.length, bytes = 44 + n * ch * 4;
  const v = new DataView(new ArrayBuffer(bytes));
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, "RIFF"); v.setUint32(4, bytes - 8, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 4, true); v.setUint16(32, ch * 4, true); v.setUint16(34, 32, true);
  s(36, "data"); v.setUint32(40, n * ch * 4, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { v.setFloat32(o, data[c][i], true); o += 4; }
  const u8 = new Uint8Array(v.buffer);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
