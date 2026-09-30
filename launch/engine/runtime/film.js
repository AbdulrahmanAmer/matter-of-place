// Browser runtime for coded films. One GSAP master timeline, seeked by the capture script; no wall clock.
//
// Contract (read by engine/capture.mjs and engine/audio.mjs):
//   window.__film = { duration (ms), ready: Promise, seek(ms): Promise }  -- seek resolves once the frame is painted.
//
// Usage in a scene module:
//   import { film, gsap } from "/launch/engine/runtime/film.js";
//   const F = film({ duration: 76 });
//   F.tl.fromTo(el, {...}, {...}, 3.2);          // absolute seconds on the master
//   F.onRender((t) => three.render(scene, cam)); // anything computed per frame (camera rigs, Three.js, sequences)
import { gsap } from "/launch/node_modules/gsap/index.js";

export { gsap };

const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

export function decode(url) {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => im.decode().then(() => ok(im), () => ok(im));
    im.onerror = () => fail(new Error("image failed: " + url));
    im.src = url;
  });
}

export function film({ duration, fonts = [], cues }) {
  // ?audio=1: render the sound design offline from the cue list (engine/audio.mjs saves it)
  if (cues && new URLSearchParams(location.search).has("audio")) {
    window.__audio = (async () => {
      const { renderCues, wavBase64 } = await import("/launch/engine/runtime/audio.js");
      const spec = await (await fetch(cues)).json();
      return wavBase64(await renderCues(spec));
    })();
  }
  gsap.globalTimeline.pause();
  gsap.ticker.lagSmoothing(0);
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
  const renderers = [];
  const waits = [];
  const F = {
    tl,
    duration,
    onRender: (fn) => renderers.push(fn),
    waitFor: (p) => waits.push(p),
    seek: async (t) => {
      tl.seek(Math.min(t, duration), true);
      const pending = [];
      for (const r of renderers) {
        const p = r(t);
        if (p) pending.push(p);
      }
      await Promise.all(pending);
      await raf();
      await raf();
    },
  };
  const ready = (async () => {
    await Promise.all(fonts.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
    // Let the scene finish building (it registers waits synchronously after film()).
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(waits);
    await F.seek(0);
    return true;
  })();
  window.__film = { duration: duration * 1000, ready, seek: (ms) => F.seek(ms / 1000) };
  return F;
}

// ---------- the vocabulary ----------

// M1 mask reveal. Markup: <div class="m1"><span class="ln"><span>line one</span></span>...</div>
export function maskIn(tl, el, at, { dur = 0.8, stagger = 0.06, ease = "expo.out" } = {}) {
  const spans = el.querySelectorAll(".ln > span");
  tl.fromTo(spans, { yPercent: 112 }, { yPercent: 0, duration: dur, stagger, ease, immediateRender: true }, at);
  return at + dur + stagger * (spans.length - 1);
}
export function maskOut(tl, el, at, { dur = 0.55, stagger = 0.04, ease = "power3.in" } = {}) {
  const spans = el.querySelectorAll(".ln > span");
  tl.to(spans, { yPercent: -112, duration: dur, stagger, ease, immediateRender: false }, at);
  return at + dur;
}

// M2 tracking expand: uppercase label opens from -0.2em to +0.14em while fading in.
export function track(tl, el, at, { dur = 1.2, from = -0.2, to = 0.14 } = {}) {
  tl.fromTo(el, { letterSpacing: `${from}em`, opacity: 0 }, { letterSpacing: `${to}em`, duration: dur, ease: "power3.out", immediateRender: true }, at);
  tl.to(el, { opacity: 1, duration: dur * 0.6, ease: "power1.out" }, at);
  return at + dur;
}

// M3 weight shift. Markup: <span class="w"><span class="w4">Word</span><span class="w5">Word</span></span>
export function weight(tl, el, at, { dur = 0.6 } = {}) {
  tl.fromTo(el.querySelectorAll(".w5"), { opacity: 0 }, { opacity: 1, duration: dur, ease: "power1.inOut", immediateRender: true }, at);
  tl.fromTo(el.querySelectorAll(".w4"), { opacity: 1 }, { opacity: 0, duration: dur, ease: "power1.inOut", immediateRender: true }, at);
  return at + dur;
}

// M4 line wipe: a 1 px Sandstone rule draws across (scaleX from its origin).
export function wipe(tl, el, at, { dur = 0.8, ease = "power3.inOut" } = {}) {
  tl.fromTo(el, { scaleX: 0 }, { scaleX: 1, duration: dur, ease, immediateRender: true }, at);
  return at + dur;
}

// M13 hard cut to black: show an Obsidian card for 6 frames.
export function black(tl, el, at, frames = 6) {
  tl.set(el, { autoAlpha: 1 }, at).set(el, { autoAlpha: 0 }, at + frames / 30);
  return at + frames / 30;
}

// Visibility window for a shot: hard in, hard out (cuts are cuts).
export function shot(tl, el, tin, tout) {
  tl.set(el, { autoAlpha: 0 }, 0).set(el, { autoAlpha: 1 }, tin);
  if (tout !== undefined) tl.set(el, { autoAlpha: 0 }, tout);
}

// ---------- M6 / M7 / M8: a photograph in three planes ----------
//
// back   = the full image (fills every hole), slowest
// subject= the same image under a soft radial mask around the subject, middle speed
// front  = a copy under an edge mask (bottom band or sides), fastest, softened by the rack focus
// Planes coincide exactly at `align` (0..1 through the move), so there is no ghosting at the start of the shot,
// and they diverge as the camera moves: that divergence is the parallax.
export function depth(F, root, { src, subject = [50, 55, 34, 42], front = "bottom", par = [1, 1.45, 2.1], origin, align = 0.35, blurBack = 0, cam: shared }) {
  root.classList.add("rig");
  const [sx, sy, rx, ry] = subject;
  const o = origin || `${sx}% ${sy}%`;
  const masks = {
    subject: `radial-gradient(ellipse ${rx}% ${ry}% at ${sx}% ${sy}%, #000 58%, transparent 100%)`,
    bottom: "linear-gradient(to top, #000 0%, #000 16%, transparent 38%)",
    top: "linear-gradient(to bottom, #000 0%, #000 14%, transparent 34%)",
    left: "linear-gradient(to right, #000 0%, #000 14%, transparent 32%)",
    right: "linear-gradient(to left, #000 0%, #000 14%, transparent 32%)",
    sides: "linear-gradient(to right, #000 0%, transparent 22%, transparent 78%, #000 100%)",
  };
  const mk = (cls, mask) => {
    const d = document.createElement("div");
    d.className = "plane " + cls;
    d.style.backgroundImage = `url("${src}")`;
    d.style.transformOrigin = o;
    if (mask) { d.style.webkitMaskImage = mask; d.style.maskImage = mask; }
    root.appendChild(d);
    return d;
  };
  const planes = [mk("back"), mk("subject", masks.subject)];
  if (front && front !== "none") planes.push(mk("front", masks[front]));
  F.waitFor(decode(src));
  // cam.z = push (0.08 = 8 %), cam.x/y = px, cam.r = deg, blur values in px
  // Pass `cam` to drive a second copy of the same rig (M9 split slide halves) from one camera.
  const cam = shared || { z: 0, x: 0, y: 0, r: 0, blurBack, blurSubject: 0, blurFront: 0, z0: 0, x0: 0, y0: 0 };
  cam.set = (z0, x0 = 0, y0 = 0) => { cam.z0 = z0; cam.x0 = x0; cam.y0 = y0; };
  F.onRender(() => {
    const blur = [cam.blurBack, cam.blurSubject, cam.blurFront];
    planes.forEach((p, i) => {
      const k = par[i];
      // alignment point: the camera state where all planes coincide
      const az = cam.z0, ax = cam.x0, ay = cam.y0;
      const s = 1 + az + (cam.z - az) * k;
      const x = ax + (cam.x - ax) * k;
      const y = ay + (cam.y - ay) * k;
      p.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${cam.r.toFixed(3)}deg) scale(${s.toFixed(5)})`;
      p.style.filter = blur[i] > 0.05 ? `blur(${blur[i].toFixed(2)}px)` : "none";
    });
  });
  if (!shared) cam.align = align;
  return cam;
}

// A camera move on a depth rig: tween from a → b over [t0, t1], and align the planes at `align` of the way.
export function move(tl, cam, t0, t1, a, b, ease = "power3.inOut") {
  const lerp = (k) => (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * (cam.align ?? 0.35);
  cam.set(lerp("z"), lerp("x"), lerp("y"));
  tl.fromTo(cam, { ...a }, { ...b, duration: t1 - t0, ease, immediateRender: true }, t0);
}

// ---------- image sequences (footage decoded to stills, product captures) ----------
export function sequence(F, img, { pattern, count, start, fps = 30, width = 4, first = 0 }) {
  const urls = Array.from({ length: count }, (_, i) => pattern.replace(/%0\dd/, String(i + first).padStart(width, "0")));
  let current = -1;
  F.onRender((t) => {
    const i = Math.min(count - 1, Math.max(0, Math.floor((t - start) * fps + 1e-6)));
    if (i === current) return;
    current = i;
    img.src = urls[i];
    return img.decode().catch(() => {});
  });
  return urls;
}
