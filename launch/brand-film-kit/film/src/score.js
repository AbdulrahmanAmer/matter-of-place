/* score.js - the soundtrack, synthesized: no samples, no licences. It is built with the film (same file scope), so events are
   written against the film's own timeline constants and a retime moves the music with the picture. One event on every cut. */
const Score = (() => {
  const rng = seed => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; };
  function impulse(ac, secs, decay) {                       // a soft room, made from decaying filtered noise
    const n = Math.floor(secs * ac.sampleRate), b = ac.createBuffer(2, n, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c), r = rng(77 + c * 131); let lp = 0;
      for (let i = 0; i < n; i++) { const u = i / n; lp += (r() - lp) * (0.5 - 0.36 * u); d[i] = lp * Math.pow(1 - u, decay) * Math.min(1, i / 600); } }
    return b;
  }
  async function render(sampleRate = 48000) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, ac = new OAC(2, Math.ceil(DUR * sampleRate), sampleRate);
    const master = ac.createGain(), comp = ac.createDynamicsCompressor(), bus = ac.createGain(), wet = ac.createGain(), conv = ac.createConvolver(), pre = ac.createGain(), lim = ac.createDynamicsCompressor();
    conv.buffer = impulse(ac, 3.2, 2.4); wet.gain.value = 0.32;
    comp.threshold.value = -18; comp.knee.value = 20; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.3;
    pre.gain.value = 2.1; lim.threshold.value = -4; lim.knee.value = 2; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.14;
    bus.connect(comp); bus.connect(conv); conv.connect(wet); wet.connect(comp); comp.connect(pre); pre.connect(lim); lim.connect(master); master.connect(ac.destination);
    master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(0.8, 0.25); master.gain.setValueAtTime(0.8, DUR - 0.7); master.gain.linearRampToValueAtTime(0, DUR);
    const nb = ac.createBuffer(1, sampleRate * 2, sampleRate); { const d = nb.getChannelData(0), r = rng(4242); for (let i = 0; i < d.length; i++) d[i] = r(); }
    const end = x => Math.min(DUR, x);
    const route = (node, p, dry) => { const dst = dry ? comp : bus; if (!ac.createStereoPanner || !p) { node.connect(dst); return; } const sp = ac.createStereoPanner(); sp.pan.value = p; node.connect(sp); sp.connect(dst); };
    // ---- instruments -------------------------------------------------------------------------------------------------
    function pad(freq, t0, dur, gain, o = {}) {              // warm sustained note: two detuned triangles and an octave, low-passed
      const { attack = 0.5, release = 1.3, cutoff = 1200, p = 0 } = o, hold = Math.max(attack, dur), g = ac.createGain(), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.4;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.setValueAtTime(gain, t0 + hold); g.gain.linearRampToValueAtTime(0, t0 + hold + release);
      for (const [mult, det, amp, type] of [[1, -5, 1, 'triangle'], [1, 6, 1, 'triangle'], [2, 0, 0.12, 'sine']]) { const o1 = ac.createOscillator(), og = ac.createGain(); o1.type = type; o1.frequency.value = freq * mult; o1.detune.value = det; og.gain.value = amp * 0.5; o1.connect(og); og.connect(lp); o1.start(t0); o1.stop(end(t0 + hold + release + 0.05)); }
      lp.connect(g); route(g, p);
    }
    const chord = (t0, dur, freqs, gain = 0.04, o = {}) => freqs.forEach((fq, i) => pad(fq, t0, dur, gain * (i === 0 ? 1.5 : 1), { ...o, p: i === 0 ? 0 : i % 2 ? 0.3 : -0.3 }));
    function mallet(freq, t0, gain = 0.12, decay = 1.2, p = 0) {   // a struck note: the accent on a cut, or a melody
      if (t0 >= DUR) return; const out = ac.createGain();
      for (const [m, a, d] of [[1, 1, decay], [2, 0.26, decay * 0.42], [3.01, 0.07, decay * 0.2]]) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = freq * m;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain * a, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.008 + d); o.connect(g); g.connect(out); o.start(t0); o.stop(end(t0 + d + 0.1)); }
      route(out, p);
    }
    function tick(t0, gain = 0.02, freq = 3200, p = 0) {      // a small click for small on-screen events
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t0 + 0.04);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06); o.connect(g); route(g, p); o.start(t0); o.stop(t0 + 0.08);
    }
    function pulse(t0, gain = 0.15) {                         // a soft felt kick: the heartbeat, kept low
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(96, t0); o.frequency.exponentialRampToValueAtTime(46, t0 + 0.11);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34); o.connect(g); route(g, 0, true); o.start(t0); o.stop(t0 + 0.4);
    }
    function sub(t0, gain = 0.24, f0 = 62, f1 = 41, decay = 1.4) {   // the weight under a big cut
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + 0.5);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay); o.connect(g); route(g, 0, true); o.start(t0); o.stop(end(t0 + decay + 0.05));
    }
    function whoosh(t0, dur, f0, f1, gain, peak = 0.7) {      // swept noise: a riser into a transition (peak late), or air for a move (peak early)
      const s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = nb; s.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + dur * peak); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); s.connect(bp); bp.connect(g); g.connect(bus); s.start(t0); s.stop(end(t0 + dur + 0.05));
    }
    // ---- the cue sheet: placeholder for the two-shot template. D major; replace with the film's own events. ----------------
    const D2 = 73.42, A2 = 110, B2 = 123.47, D3 = 146.83, Fs3 = 185, A3 = 220, D4 = 293.66, Fs4 = 369.99, A4 = 440, B4 = 493.88, D5 = 587.33, Fs5 = 739.99, A5 = 880;
    chord(0.05, T_B - 0.6, [D3, A3, D4, Fs4]); mallet(A4, 0.3, 0.1); mallet(Fs5, 0.3 + BEAT * 2, 0.05, 1.0, 0.3);
    whoosh(T_B - 1.0, 1.0, 240, 3200, 0.14, 0.9);                                    // a riser into the cut
    chord(T_B, DUR - T_B - 1.2, [B2, Fs3, A3, D4, Fs4]); sub(T_B, 0.22); mallet(B4, T_B, 0.12); mallet(D5, T_B + BEAT * 2, 0.06, 1.0, -0.3);
    for (let t = BEAT; t < DUR - 0.5; t += BEAT) pulse(t, 0.1);
    return ac.startRendering();
  }
  return { render };
})();
