/* Soundtrack: synthesized once into a buffer. 80 BPM, D major, one event per cut. */
const Score = (() => {
  'use strict';
  const DUR = 30, B = 0.75;
  const rng = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; };
  function impulse(ac, secs, decay) {
    const n = Math.floor(secs * ac.sampleRate), b = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c), r = rng(77 + c * 131); let lp = 0;
      for (let i = 0; i < n; i++) { const u = i / n; lp += (r() - lp) * (0.5 - 0.36 * u); d[i] = lp * Math.pow(1 - u, decay) * Math.min(1, i / 600); }
    }
    return b;
  }
  function noise(ac) { const n = ac.sampleRate * 2, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0), r = rng(4242); for (let i = 0; i < n; i++) d[i] = r(); return b; }

  async function render(sampleRate = 48000) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ac = new OAC(2, Math.ceil(DUR * sampleRate), sampleRate);
    const master = ac.createGain(), comp = ac.createDynamicsCompressor(), bus = ac.createGain(), wet = ac.createGain(), conv = ac.createConvolver(), pre = ac.createGain(), lim = ac.createDynamicsCompressor();
    conv.buffer = impulse(ac, 3.2, 2.4); wet.gain.value = 0.32;
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.3;
    pre.gain.value = 2.1; lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.14;
    bus.connect(comp); bus.connect(conv); conv.connect(wet); wet.connect(comp); comp.connect(pre); pre.connect(lim); lim.connect(master); master.connect(ac.destination);
    master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.8, 0.25); master.gain.setValueAtTime(0.8, 29.3); master.gain.linearRampToValueAtTime(0, DUR);
    const nb = noise(ac), end = x => Math.min(DUR, x);
    const route = (node, p, dry) => { const dst = dry ? comp : bus; if (!ac.createStereoPanner || !p) { node.connect(dst); return; } const sp = ac.createStereoPanner(); sp.pan.value = p; node.connect(sp); sp.connect(dst); };

    function pad(freq, t0, dur, gain, o = {}) {
      const { attack = 0.5, release = 1.3, cutoff = 1200, p = 0 } = o, hold = Math.max(attack, dur);
      const g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.4;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.setValueAtTime(gain, t0 + hold); g.gain.linearRampToValueAtTime(0, t0 + hold + release);
      for (const [mult, det, amp, type] of [[1, -5, 1, 'triangle'], [1, 6, 1, 'triangle'], [2, 0, 0.12, 'sine']]) {
        const o1 = ac.createOscillator(), og = ac.createGain(); o1.type = type; o1.frequency.value = freq * mult; o1.detune.value = det; og.gain.value = amp * 0.5;
        o1.connect(og); og.connect(lp); o1.start(t0); o1.stop(end(t0 + hold + release + 0.05));
      }
      lp.connect(g); route(g, p);
    }
    function mallet(freq, t0, gain = 0.12, decay = 1.2, p = 0) {
      if (t0 >= DUR) return;
      const out = ac.createGain();
      for (const [m, a, d] of [[1, 1, decay], [2, 0.26, decay * 0.42], [3.01, 0.07, decay * 0.2]]) {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = freq * m;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain * a, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.008 + d);
        o.connect(g); g.connect(out); o.start(t0); o.stop(end(t0 + d + 0.1));
      }
      route(out, p);
    }
    function tick(t0, gain = 0.02, freq = 3200, p = 0) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t0 + 0.04);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
      o.connect(g); route(g, p); o.start(t0); o.stop(t0 + 0.08);
    }
    // a soft felt-kick pulse: the launch-film heartbeat, kept low
    function pulse(t0, gain = 0.15) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(96, t0); o.frequency.exponentialRampToValueAtTime(46, t0 + 0.11);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
      o.connect(g); route(g, 0, true); o.start(t0); o.stop(t0 + 0.4);
    }
    function shaker(t0, gain = 0.012, p = 0) {
      const s = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nb; s.loop = true;
      hp.type = 'highpass'; hp.frequency.value = 6500;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      s.connect(hp); hp.connect(g); route(g, p); s.start(t0, (t0 * 0.37) % 1.5); s.stop(t0 + 0.1);
    }
    function sub(t0, gain = 0.24, f0 = 62, f1 = 41, decay = 1.4) {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + 0.5);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.connect(g); route(g, 0, true); o.start(t0); o.stop(end(t0 + decay + 0.05));
    }
    function whoosh(t0, dur, f0, f1, gain, peak = 0.7, p0 = 0, p1 = 0) {
      const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nb; s.loop = true;
      bp.type = 'bandpass'; bp.Q.value = 0.9; bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + dur * peak); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(bp); bp.connect(g);
      if (ac.createStereoPanner && (p0 || p1)) { const sp = ac.createStereoPanner(); sp.pan.setValueAtTime(p0, t0); sp.pan.linearRampToValueAtTime(p1, t0 + dur); g.connect(sp); sp.connect(bus); } else g.connect(bus);
      s.start(t0); s.stop(end(t0 + dur + 0.05));
    }
    const chord = (t0, dur, freqs, gain = 0.04, o = {}) => freqs.forEach((fq, i) => pad(fq, t0, dur, gain * (i === 0 ? 1.5 : 1), { ...o, p: i === 0 ? 0 : i % 2 ? 0.3 : -0.3 }));

    const D2 = 73.42, E2 = 82.41, G2 = 98, A2 = 110, B2 = 123.47, D3 = 146.83, E3 = 164.81, Fs3 = 185, G3 = 196, A3 = 220, B3 = 246.94, Cs4 = 277.18, D4 = 293.66, E4 = 329.63, Fs4 = 369.99, G4 = 392,
      A4 = 440, B4 = 493.88, Cs5 = 554.37, D5 = 587.33, E5 = 659.25, Fs5 = 739.99, G5 = 783.99, A5 = 880, B5 = 987.77, D6 = 1174.66, E6 = 1318.51;

    // 0.0  the door: room tone, air, two notes for the two halves of the sentence
    pad(D2, 0.05, 3.3, 0.1, { attack: 1.1, release: 0.9, cutoff: 460 });
    pad(A2, 0.5, 2.9, 0.05, { attack: 1.2, release: 0.9, cutoff: 620 });
    pad(D3, 0.45, 2.9, 0.03, { attack: 1.0, release: 0.8, cutoff: 900, p: -0.25 }); pad(A3, 0.55, 2.8, 0.026, { attack: 1.0, release: 0.8, cutoff: 1000, p: 0.25 });
    pad(A5, 0.55, 2.0, 0.011, { attack: 0.9, release: 0.9, cutoff: 3200 });
    whoosh(0.45, 1.4, 480, 1500, 0.03, 0.45);
    mallet(A4, 0.8, 0.06, 1.8, -0.25); mallet(D5, 1.1, 0.06, 1.8, 0.25);
    whoosh(2.8, 1.0, 240, 3600, 0.17, 0.9);
    // 3.75 the gallery: D. The pulse starts here and carries to the packages.
    chord(3.75, 2.9, [D3, A3, D4, E4, Fs4]); sub(3.75, 0.2); mallet(A4, 3.75, 0.12); mallet(Fs5, 4.5, 0.05, 1.0, 0.3); mallet(E5, 5.25, 0.05, 1.0, -0.3); mallet(A5, 6.0, 0.05, 1.0, 0.2);
    for (let b = 5; b < 33; b++) { const t = b * B; pulse(t, t < 6.7 ? 0.1 : 0.14); shaker(t + B / 2, 0.011, b % 2 ? 0.25 : -0.25); if (t >= 9.75) shaker(t + B * 0.75, 0.006, 0.1); }
    // 6.75 curate: Bm. The eye moves, one is kept, the rest become drawings.
    chord(6.75, 2.9, [B2, Fs3, A3, D4, Fs4]); mallet(B4, 6.75, 0.12);
    [7.2, 7.5, 7.8, 8.1].forEach((x, i) => tick(x, 0.017, 2900 + i * 240, 0.3)); mallet(D5, 8.4, 0.07, 1.0, 0.3); mallet(Fs5, 8.52, 0.06, 1.0, 0.3);
    whoosh(8.8, 1.0, 1800, 300, 0.035, 0.4, 0.4, 0.2);
    // 9.75 frame: G, three beats.
    chord(9.75, 2.15, [G2, D3, G3, B3, D4]); mallet(D5, 9.75, 0.12); mallet(B4, 10.5, 0.05, 1.0, 0.3); mallet(G5, 11.25, 0.05, 1.0, 0.3);
    tick(11.15, 0.016, 2600, 0.35); tick(11.22, 0.016, 3100, 0.35);
    // 12.0 publish: A. A shutter, then the page.
    whoosh(11.97, 0.09, 4200, 1500, 0.05, 0.15, 0.35, 0.35);
    chord(12.0, 2.9, [A2, E3, A3, Cs4, E4]); mallet(E5, 12.0, 0.12); mallet(Cs5, 12.75, 0.05, 1.0, 0.3); mallet(A4, 13.5, 0.045, 1.0, -0.3); mallet(E5, 14.25, 0.045, 1.0, 0.3);
    for (let i = 0; i < 7; i++) tick(12.97 + i * 0.055, 0.008, 3600 + (i % 3) * 300, 0.3);
    // 15.0 distribute: Bm → night. A rising figure as the cards go out.
    chord(15.0, 2.1, [B2, Fs3, B3, D4, Fs4]); sub(15.0, 0.24); mallet(Fs5, 15.0, 0.12);
    [D5, E5, Fs5, A5, B5, D6, E6, D6].forEach((fq, i) => mallet(fq, 15.2 + i * 0.1875, 0.04, 0.6, 0.15 + (i % 2) * 0.3));
    whoosh(15.25, 1.6, 2400, 260, 0.045, 0.3, 0.5, -0.2);
    // 17.25 three markets: D, Bm, G — two beats each
    chord(17.25, 1.35, [D3, A3, D4, Fs4, A4], 0.04, { attack: 0.08, release: 0.5 }); sub(17.25, 0.22); mallet(A4, 17.25, 0.12); mallet(D5, 17.625, 0.06); mallet(Fs5, 18.0, 0.07);
    chord(18.75, 1.35, [B2, Fs3, B3, D4, Fs4], 0.04, { attack: 0.08, release: 0.5, cutoff: 900 }); sub(18.75, 0.24, 58, 38); mallet(Fs4, 18.75, 0.12); mallet(B4, 19.125, 0.06); mallet(D5, 19.5, 0.07);
    chord(20.25, 1.35, [G2, D3, G3, B3, D4, G4], 0.04, { attack: 0.08, release: 0.5, cutoff: 1500 }); sub(20.25, 0.22); mallet(B4, 20.25, 0.12); mallet(D5, 20.625, 0.06); mallet(G5, 21.0, 0.07);
    // 21.75 the four packages: A, one note as each rises
    chord(21.75, 2.9, [A2, E3, A3, Cs4, E4]); sub(21.75, 0.26);
    [A4, Cs5, E5, A5].forEach((fq, i) => mallet(fq, 21.75 + i * 0.3, 0.1, 1.3, -0.45 + i * 0.3));
    mallet(E5, 23.25, 0.05, 1.0, 0.3); mallet(Cs5, 24.0, 0.05, 1.0, -0.3);
    // 24.75 the principle: the pulse stops. G, then one word.
    chord(24.75, 1.75, [G2, D3, G3, B3, D4], 0.036, { attack: 0.2, release: 0.6 }); mallet(B4, 24.77, 0.1); mallet(D5, 25.5, 0.12); mallet(Fs5, 25.5, 0.045); mallet(G5, 26.25, 0.035, 1.2, 0.2);
    // 27.0 back through the door, and the mark: D
    whoosh(26.6, 1.15, 220, 2600, 0.24, 0.93);
    pad(D2, 26.7, 0.9, 0.075, { attack: 0.98, release: 0.5, cutoff: 520 }); pad(A3, 26.9, 0.72, 0.03, { attack: 0.82, release: 0.4, cutoff: 1500 });
    chord(27.75, 1.7, [D2, A2, D3, A3, D4, Fs4], 0.044, { attack: 0.35, release: 1.6 }); sub(27.9, 0.3, 62, 37, 1.8);
    mallet(A4, 27.9, 0.12, 1.8); mallet(D5, 28.09, 0.1, 1.8, -0.2); mallet(A5, 28.28, 0.075, 1.9, 0.2); mallet(D6, 28.85, 0.03, 1.4);
    return ac.startRendering();
  }
  return { render, DUR };
})();
