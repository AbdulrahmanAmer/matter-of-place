// Deterministic timeline for coded films. No wall clock anywhere.
//
// Any element with data-in / data-out (absolute seconds) is a layer:
//   data-in="7"  data-out="16"     visible window (out omitted = until the end)
//   data-fi="1.5" data-fo="1.5"    fade-in / fade-out durations (defaults 1.5 / 1.5)
//   data-drift="1.02"              scale from 1 to this value, linearly, across the window
//   data-dx="-1" data-dy="0"       optional translate across the window, in percent
// Nested layers multiply through the DOM, so a text line can fade in inside a shot and
// leave with the shot (data-fo="0").
//
// Frame sequences (for footage decoded to stills by ffmpeg):
//   <img data-seq="media-cache/tiburon/%03d.jpg" data-seq-start="16" data-seq-count="180" data-seq-fps="30">
//
// window.__ready resolves once fonts and every image are decoded.
// window.__seek(ms) positions every layer and resolves after the frame's images are decoded.
// window.__duration is the film length in ms (set by the scene: <body data-duration="72">).

(() => {
  const easeInOut = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  const num = (el, key, dflt) => (el.dataset[key] !== undefined ? parseFloat(el.dataset[key]) : dflt);

  const duration = parseFloat(document.body.dataset.duration);
  window.__duration = duration * 1000;

  const layers = [...document.querySelectorAll("[data-in]")].map((el) => ({
    el,
    tin: num(el, "in", 0),
    tout: num(el, "out", duration),
    fi: num(el, "fi", 1.5),
    fo: num(el, "fo", 1.5),
    drift: num(el, "drift", 1),
    dx: num(el, "dx", 0),
    dy: num(el, "dy", 0),
  }));

  const pad = (n, w) => String(n).padStart(w, "0");
  const seqs = [...document.querySelectorAll("[data-seq]")].map((el) => {
    const pattern = el.dataset.seq;
    const width = parseInt(pattern.match(/%0(\d)d/)[1], 10);
    const count = parseInt(el.dataset.seqCount, 10);
    const urls = Array.from({ length: count }, (_, i) => pattern.replace(/%0\dd/, pad(i + 1, width)));
    return { el, urls, start: num(el, "seqStart", 0), fps: num(el, "seqFps", 30), current: -1 };
  });

  const decodeAll = (urls) =>
    Promise.all(
      urls.map(
        (u) =>
          new Promise((res, rej) => {
            const im = new Image();
            im.onload = () => im.decode().then(res, res);
            im.onerror = () => rej(new Error("image failed: " + u));
            im.src = u;
          }),
      ),
    );

  window.__ready = (async () => {
    await document.fonts.ready;
    const staticImgs = [...document.images].filter((i) => !i.dataset.seq).map((i) => i.src);
    const bgUrls = [...document.querySelectorAll("[data-bg]")].map((e) => e.dataset.bg);
    await decodeAll([...staticImgs, ...bgUrls, ...seqs.flatMap((s) => s.urls)]);
    for (const e of document.querySelectorAll("[data-bg]")) e.style.backgroundImage = `url("${e.dataset.bg}")`;
    await Promise.all([...document.images].map((i) => (i.complete ? i.decode().catch(() => {}) : null)));
    return true;
  })();

  window.__seek = async (ms) => {
    const t = ms / 1000;
    for (const L of layers) {
      let o = 0;
      if (t >= L.tin && t <= L.tout) {
        const a = L.fi > 0 ? easeInOut((t - L.tin) / L.fi) : 1;
        const b = L.fo > 0 ? easeInOut((L.tout - t) / L.fo) : 1;
        o = Math.min(a, b);
      }
      L.el.style.opacity = o.toFixed(4);
      L.el.style.visibility = o > 0 ? "visible" : "hidden";
      if (L.drift !== 1 || L.dx || L.dy) {
        const p = Math.min(1, Math.max(0, (t - L.tin) / (L.tout - L.tin)));
        const s = 1 + (L.drift - 1) * p;
        L.el.style.transform = `translate(${(L.dx * p).toFixed(4)}%, ${(L.dy * p).toFixed(4)}%) scale(${s.toFixed(5)})`;
      }
    }
    const pending = [];
    for (const S of seqs) {
      const i = Math.min(S.urls.length - 1, Math.max(0, Math.floor((t - S.start) * S.fps)));
      if (i !== S.current) {
        S.current = i;
        S.el.src = S.urls[i];
        pending.push(S.el.decode().catch(() => {}));
      }
    }
    await Promise.all(pending);
    return true;
  };
})();
