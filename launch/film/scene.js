// Matter of Place, launch film. Every beat of MOTION-BIBLE §4 on one GSAP master timeline (absolute seconds).
// Shot list and reasons: STORYBOARD.md. Sound cues on the same clock: cues.json.
import { film, gsap, maskIn, maskOut, track, weight, wipe, black, shot, depth, move, sequence, decode } from "/launch/engine/runtime/film.js";

const ASSET = "/app/src/assets/";
const A = (n) => ASSET + n;
const $ = (s) => document.querySelector(s);

export const DURATION = 68.9;
const F = film({
  duration: DURATION,
  cues: "/launch/film/cues.json",
  fonts: ['400 100px "Cormorant Garamond"', '500 100px "Cormorant Garamond"', '300 40px "Jost"', '400 16px "Jost"'],
});
const tl = F.tl;
const CAM = "power3.inOut";

// ---------------------------------------------------------------- B1 · 0.00 to 1.90 · M4 + M11 on Obsidian
shot(tl, $("#b1"), 0, 1.65);
wipe(tl, $("#b1-rule"), 0.3, { dur: 1.2 });
tl.fromTo("#b1-sweep", { x: -900, rotation: 18, opacity: 0.16 }, { x: 2300, duration: 2.2, ease: "power1.inOut", immediateRender: true }, 0);

// ---------------------------------------------------------------- B2 · 1.60 to 7.60 · terrace at dusk, M6 + M8
shot(tl, $("#b2"), 1.65, 7.6);
// the two halves carry the rule on their edges as they part, and the rule thins away
tl.fromTo("#b2 .rule", { opacity: 1 }, { opacity: 0, duration: 0.9, ease: "power1.in", immediateRender: true }, 1.75);
const b2 = depth(F, $("#b2-rig"), { src: A("gallery/ca-terrace.jpg"), subject: [44, 50, 40, 46], front: "bottom", par: [1, 1.5, 2.3] });
b2.blurSubject = 8; b2.blurBack = 2.5;
move(tl, b2, 1.6, 7.6, { z: 0, x: 30, y: 16 }, { z: 0.095, x: -40, y: -10 }, "none");
// the rule opens into an aperture
tl.fromTo("#b2-top", { yPercent: 0 }, { yPercent: -100, duration: 1.1, ease: CAM, immediateRender: true }, 1.65);
tl.fromTo("#b2-bot", { yPercent: 0 }, { yPercent: 100, duration: 1.1, ease: CAM, immediateRender: true }, 1.65);
// M8 rack focus: subject sharpens, foreground softens, the valley stays a touch soft
tl.to(b2, { blurSubject: 0, blurBack: 1.2, blurFront: 5, duration: 1.0, ease: "power2.inOut" }, 2.7);

// ---------------------------------------------------------------- B3 · 7.60 to 11.20 · M1 + M3 over the house
shot(tl, $("#b3"), 7.6, 11.2);
const b3 = depth(F, $("#b3-rig"), { src: A("los-altos.jpg"), subject: [66, 52, 36, 44], front: "left", par: [1, 1.45, 2.2] });
b3.blurBack = 1.5; b3.blurFront = 3;
move(tl, b3, 7.6, 11.2, { z: 0.02, x: 50, y: 30, r: -0.4 }, { z: 0.085, x: -30, y: -20, r: 0.3 }, "none");
maskIn(tl, $("#b3-text"), 7.85, { dur: 0.8 });
weight(tl, $("#b3-text .w"), 8.95);
maskOut(tl, $("#b3-text"), 10.55);

// ---------------------------------------------------------------- B4 · 11.20 · M13
tl.set("#b4", { autoAlpha: 0 }, 0);
black(tl, $("#b4"), 11.2);

// ---------------------------------------------------------------- B5 · 11.40 to 19.20 · triplet, M9 between
// a: Tiburon water (footage, 24 fps), split to reveal b: Manhattan, split to reveal c: Palm Beach loggia
shot(tl, $("#b5a"), 11.4, 14.35);
const tib = { pattern: "/launch/film/media/tiburon/%03d.jpg", count: 72, start: 11.4, fps: 24, width: 3, first: 40 };
const tibUrls = sequence(F, $("#b5a-seq-l"), tib);
sequence(F, $("#b5a-seq-r"), tib);
F.waitFor(Promise.all(tibUrls.map(decode)));
const b5aCam = { s: 1.0 };
tl.fromTo(b5aCam, { s: 1.07 }, { s: 1.15, duration: 2.95, ease: "none", immediateRender: true }, 11.4);
F.onRender(() => { for (const id of ["#b5a-seq-l", "#b5a-seq-r"]) { $(id).style.transformOrigin = "28% 50%"; $(id).style.transform = `scale(${b5aCam.s.toFixed(5)})`; } });

shot(tl, $("#b5b"), 13.65, 16.95);
const b5b = depth(F, $("#b5b-l"), { src: A("manhattan.jpg"), subject: [50, 52, 30, 40], front: "sides", par: [1, 1.5, 2.4] });
depth(F, $("#b5b-r"), { src: A("manhattan.jpg"), subject: [50, 52, 30, 40], front: "sides", par: [1, 1.5, 2.4], cam: b5b });
move(tl, b5b, 13.65, 16.95, { z: 0.03, x: 90, y: 0 }, { z: 0.07, x: -90, y: -12 }, "none");

shot(tl, $("#b5c"), 16.25, 19.2);
const b5c = depth(F, $("#b5c-rig"), { src: A("gallery/fl-loggia.jpg"), subject: [62, 55, 28, 40], front: "left", par: [1, 1.6, 2.6] });
b5c.blurFront = 2.5;
move(tl, b5c, 16.25, 19.2, { z: 0.0, x: 40, y: 10 }, { z: 0.1, x: -60, y: -6 }, "none");

// M9: the outgoing frame parts into left and right panels that slide opposite ways
const split = (l, r, at) => {
  tl.set(l, { clipPath: "inset(0 50% 0 0)" }, 0).set(r, { clipPath: "inset(0 0 0 50%)" }, 0);
  tl.fromTo(l, { xPercent: 0 }, { xPercent: -52, duration: 0.7, ease: "power3.in", immediateRender: true }, at);
  tl.fromTo(r, { xPercent: 0 }, { xPercent: 52, duration: 0.7, ease: "power3.in", immediateRender: true }, at);
};
split("#b5a-l", "#b5a-r", 13.65);
split("#b5b-l", "#b5b-r", 16.25);

// ---------------------------------------------------------------- B6 · 19.20 to 24.40 · Place matters. then the names
shot(tl, $("#b6"), 19.2, 24.4);
maskIn(tl, $("#b6-text"), 19.3, { dur: 0.9 });
tl.fromTo("#b6-text", { y: 40 }, { y: -50, duration: 4.5, ease: "none", immediateRender: true }, 19.3);
tl.fromTo("#b6-sweep", { x: -900, rotation: 16, opacity: 0.2 }, { x: 2300, duration: 1.8, ease: "power1.inOut", immediateRender: true }, 19.9);
// rapid triplet behind the words, 0.4 s each, each with its place name tracking open
const flashes = [["#b6-f1", "tiburon.jpg", [60, 45, 36, 44]], ["#b6-f2", "manhattan.jpg", [50, 50, 32, 40]], ["#b6-f3", "palm-beach.jpg", [55, 50, 34, 42]]];
flashes.forEach(([id, img, subj], i) => {
  const t0 = 21.0 + i * 0.4;
  const end = i === 2 ? 24.4 : t0 + 0.4;
  shot(tl, $(id), t0, end);
  const c = depth(F, $(id), { src: A(img), subject: subj, front: "bottom", par: [1, 1.5, 2.2] });
  move(tl, c, t0, end, { z: 0.02, x: 20 }, { z: i === 2 ? 0.1 : 0.04, x: i === 2 ? -60 : -10 }, "none");
  shot(tl, $(`#b6-n${i + 1}`), t0, i === 2 ? 22.2 : t0 + 0.4);
  track(tl, $(`#b6-n${i + 1}`), t0, { dur: 0.5, from: -0.1, to: 0.3 });
});
tl.set("#b6-scrim", { opacity: 0 }, 0).set("#b6-scrim", { opacity: 0.5 }, 21.0);
tl.to("#b6-scrim", { opacity: 0.62, duration: 2.2, ease: "power1.inOut" }, 22.2);
shot(tl, $("#b6-all"), 22.2);
track(tl, $("#b6-all"), 22.2, { dur: 1.4, from: -0.2, to: 0.26 });
maskOut(tl, $("#b6-text"), 23.8, { dur: 0.5 });

// ---------------------------------------------------------------- B7 · 24.40 to 30.40 · M5 threshold, M1 wordmark
shot(tl, $("#b7"), 24.4, 29.6);
tl.fromTo("#b7-back", { x: 46 }, { x: 0, duration: 1.4, ease: "power3.inOut", immediateRender: true }, 24.4);
tl.fromTo("#b7-front", { x: -46 }, { x: 0, duration: 1.4, ease: "power3.inOut", immediateRender: true }, 24.4);
tl.fromTo("#b7-back", { opacity: 0 }, { opacity: 0.4, duration: 0.6, ease: "power1.out", immediateRender: true }, 24.5);
tl.fromTo("#b7-front", { opacity: 0 }, { opacity: 0.9, duration: 0.6, ease: "power1.out", immediateRender: true }, 24.5);
// camera: close on the threshold, then pull back to reveal the name; drift continues to the cut
tl.set("#b7-cam", { transformOrigin: "960px 417px" }, 0);
tl.fromTo("#b7-cam", { scale: 3.1 }, { scale: 1.0, duration: 3.9, ease: "power1.inOut", immediateRender: true }, 25.5);
const wordmark = (el) => {
  el.innerHTML = "";
  const parts = ["M", "Λ", "T", "T", "E", "R", " ", "OF", " ", "P", "L", "Λ", "C", "E"];
  for (const p of parts) {
    if (p === " ") { el.appendChild(document.createTextNode(" ")); continue; }
    const ch = document.createElement("span");
    ch.className = "ch";
    ch.innerHTML = p === "OF" ? "<span><small>OF</small></span>" : `<span>${p}</span>`;
    el.appendChild(ch);
  }
  return el.querySelectorAll(".ch > span");
};
const w7 = wordmark($("#b7-word"));
tl.fromTo(w7, { yPercent: 110 }, { yPercent: 0, duration: 0.9, stagger: 0.035, ease: "expo.out", immediateRender: true }, 28.1);

// ---------------------------------------------------------------- B8 · 30.40 to 40.40 · the product, M12 + M1
shot(tl, $("#b8"), 29.6, 40.4);
const P = "/launch/film/product/";
const prod = [
  { name: "home", t0: 29.6, t1: 33.8, first: 0 },
  { name: "grid", t0: 33.8, t1: 37.0, first: 0 },
  { name: "dossier", t0: 37.0, t1: 40.4, first: 18 },
];
const cursors = {};
F.waitFor(fetch(P + "grid/cursor.json").then((r) => r.json()).then((j) => { cursors.grid = j; }));
const screenImg = $("#b8-img");
const prodUrls = [];
for (const p of prod) {
  const n = Math.round((p.t1 - p.t0) * 30);
  for (let i = 0; i < n; i++) prodUrls.push(P + `${p.name}/${String(p.first + i).padStart(4, "0")}.jpg`);
}
let prodCurrent = "";
F.onRender((t) => {
  const p = prod.find((q) => t >= q.t0 && t < q.t1) || (t >= 40.4 ? prod[2] : prod[0]);
  const i = p.first + Math.min(Math.round((p.t1 - p.t0) * 30) - 1, Math.max(0, Math.floor((t - p.t0) * 30 + 1e-6)));
  const url = P + `${p.name}/${String(i).padStart(4, "0")}.jpg`;
  const c = p.name === "grid" && cursors.grid ? cursors.grid[i] : null;
  const cur = $("#b8-cursor");
  cur.style.visibility = c ? "visible" : "hidden";
  if (c) cur.style.transform = `translate3d(${(c[0] - 4).toFixed(1)}px, ${(c[1] - 2).toFixed(1)}px, 40px)`;
  if (url === prodCurrent) return;
  prodCurrent = url;
  screenImg.src = url;
  return screenImg.decode().catch(() => {});
});
// the screen sits in depth; each product shot gets its own camera, cut to cut
const scr = $("#b8-screen");
tl.fromTo(scr, { rotationY: -16, rotationX: 7, z: -520, x: 120, y: 20, filter: "blur(6px)" },
  { rotationY: -6, rotationX: 3, z: -200, x: 30, y: 0, duration: 4.2, ease: "power1.out", immediateRender: true }, 29.6);
tl.to(scr, { filter: "blur(0px)", duration: 0.9, ease: "power2.inOut" }, 29.6);
tl.set(scr, { rotationY: 9, rotationX: 4, z: 60, x: -200, y: 60 }, 33.8);
tl.to(scr, { rotationY: 4, rotationX: 2, z: 260, x: -330, y: 160, duration: 3.2, ease: "power1.inOut" }, 33.8);
tl.set(scr, { rotationY: -5, rotationX: 5, z: -120, x: 0, y: 40 }, 37.0);
tl.to(scr, { rotationY: -1.5, rotationX: 2, z: 560, x: 90, y: 250, duration: 3.4, ease: "power2.inOut" }, 37.0);

// ---------------------------------------------------------------- B9 · 40.40 to 47.60 · three rooms, M10 grid, grow
const rooms = [["#b9a", "gallery/ca-stair.jpg", [52, 55, 34, 44], "right"], ["#b9b", "gallery/coast-bedroom.jpg", [60, 45, 34, 42], "bottom"], ["#b9c", "gallery/fl-bath.jpg", [42, 58, 32, 42], "left"]];
rooms.forEach(([id, img, subj, front], i) => {
  const t0 = 40.4 + i * 0.4;
  shot(tl, $(id), t0, t0 + 0.4);
  const c = depth(F, $(id + "-rig"), { src: A(img), subject: subj, front, par: [1, 1.6, 2.6] });
  move(tl, c, t0, t0 + 0.4, { z: 0.03, x: i % 2 ? -30 : 30 }, { z: 0.075, x: i % 2 ? 30 : -30 }, "none");
});
shot(tl, $("#b9"), 41.6, 47.6);
const tiles = ["los-altos.jpg", "tiburon.jpg", "san-francisco.jpg", "mill-valley.jpg", null, "palm-beach.jpg", "miami.jpg", "manhattan.jpg", "hamptons.jpg"];
const W = 480, H = 270, G = 24, X0 = 960 - (3 * W + 2 * G) / 2, Y0 = 540 - (3 * H + 2 * G) / 2;
const order = [4, 1, 5, 7, 3, 0, 8, 2, 6]; // centre outwards
const offs = [[-70, -40], [0, -60], [70, -40], [-80, 0], [0, 0], [80, 0], [-70, 40], [0, 60], [70, 40]];
tiles.forEach((img, k) => {
  if (!img) return;
  const d = document.createElement("div");
  d.className = "tile";
  d.style.left = X0 + (k % 3) * (W + G) + "px";
  d.style.top = Y0 + Math.floor(k / 3) * (H + G) + "px";
  d.style.backgroundImage = `url("${A(img)}")`;
  F.waitFor(decode(A(img)));
  $("#b9-grid").appendChild(d);
  const at = 41.7 + order.indexOf(k) * 0.075;
  tl.fromTo(d, { x: offs[k][0], y: offs[k][1], scale: 0.9, autoAlpha: 0 }, { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 1.1, ease: "back.out(1.25)", immediateRender: true }, at);
});
// the centre tile is the Laguna rig itself, scaled to tile size, then it grows to the frame
const b9 = depth(F, $("#b9-rig"), { src: A("laguna.jpg"), subject: [48, 50, 36, 44], front: "bottom", par: [1, 1.5, 2.3] });
tl.fromTo("#b9-grow", { scale: 0.25, x: 0, y: 30 * 0, autoAlpha: 0 }, { scale: 0.25, autoAlpha: 1, duration: 0.9, ease: "back.out(1.25)", immediateRender: true }, 41.7);
tl.fromTo("#b9-grid", { scale: 1 }, { scale: 1.035, duration: 2.5, ease: "none", immediateRender: true }, 41.7);
tl.to("#b9-grow", { scale: 0.25 * 1.035, duration: 2.5, ease: "none" }, 41.7);
tl.to("#b9-grow", { scale: 1, duration: 1.1, ease: CAM }, 44.2);
tl.to("#b9-grid", { scale: 1.6, duration: 1.1, ease: CAM }, 44.2);
move(tl, b9, 41.7, 47.6, { z: 0.0, x: 0, y: 0 }, { z: 0.11, x: -50, y: -16 }, "none");

// ---------------------------------------------------------------- B10 · 47.60 to 54.00 · four words, M1 + M3
shot(tl, $("#b10"), 47.6, 54.0);
const words = ["Selected.", "Edited.", "Published.", "Distributed."];
const row = $("#b10-row");
const wordEls = words.map((w) => {
  const d = document.createElement("div");
  d.className = "m1 serif";
  d.style.cssText = "font-size:80px; line-height:1; color:var(--obsidian);";
  d.innerHTML = `<span class="ln"><span class="w"><span class="w4">${w}</span><span class="w5">${w}</span></span></span>`;
  row.appendChild(d);
  return d;
});
// Each word joins the row; the row re-centres as it grows (width measured after fonts load).
const rowState = { x: 0 };
const widths = [];
F.waitFor(document.fonts.ready.then(() => { wordEls.forEach((el) => widths.push(el.getBoundingClientRect().width)); }));
const rowShift = (n) => { // x offset so that the first n words are centred
  const total = widths.reduce((a, b) => a + b, 0) + 44 * (widths.length - 1);
  const shown = widths.slice(0, n).reduce((a, b) => a + b, 0) + 44 * (n - 1);
  return (total - shown) / 2;
};
F.onRender((t) => { const k = Math.min(6.4, Math.max(0, t - 47.6)); const drift = 50 - k * 15.6; row.style.transform = `translateX(${(rowState.x + drift).toFixed(2)}px) scale(${(1 + k * 0.01).toFixed(4)})`; });
wordEls.forEach((el, i) => {
  const at = 47.75 + i * 1.1;
  maskIn(tl, el, at, { dur: 0.75 });
  weight(tl, el.querySelector(".w"), at + 0.5, { dur: 0.6 });
});
F.waitFor(document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
  rowState.x = rowShift(1);
  wordEls.forEach((el, i) => { if (i) tl.fromTo(rowState, { x: rowShift(i) }, { x: rowShift(i + 1), duration: 0.9, ease: "power3.inOut", immediateRender: false }, 47.65 + i * 1.1); });
}));
wordEls.forEach((el, i) => maskOut(tl, el, 52.95 + i * 0.05, { dur: 0.5 }));

// ---------------------------------------------------------------- B11 · 54.00 to 60.00 · M7 crane, M2 markets
shot(tl, $("#b11"), 54.0, 60.0);
const b11 = depth(F, $("#b11-rig"), { src: A("hudson-valley.jpg"), subject: [46, 60, 50, 44], front: "bottom", par: [1, 1.0, 1.6], align: 0.5 });
b11.blurFront = 1.2;
move(tl, b11, 54.0, 60.0, { z: 0.03, x: 30, y: 70, r: -1.1 }, { z: 0.07, x: -30, y: -60, r: 0.6 }, "none");
track(tl, $("#b11-text"), 54.6, { dur: 1.6, from: -0.2, to: 0.18 });
wipe(tl, $("#b11-rule"), 55.6, { dur: 0.9 });

// ---------------------------------------------------------------- B12 · 60.00 to 64.40 · M1 + M11, silence
shot(tl, $("#b12"), 60.0, 64.4);
maskIn(tl, $("#b12-text"), 60.25, { dur: 0.9, stagger: 0.14 });
tl.fromTo("#b12-sweep", { x: -900, rotation: 20, opacity: 0.13 }, { x: 2300, duration: 1.8, ease: "power1.inOut", immediateRender: true }, 61.2);
tl.fromTo("#b12-text", { scale: 1, y: 40 }, { scale: 1.07, y: -40, duration: 4.1, ease: "none", immediateRender: true }, 60.25);
maskOut(tl, $("#b12-text"), 63.55, { dur: 0.55 });

// ---------------------------------------------------------------- B13 · 64.40 to 72.60 · the lock
shot(tl, $("#b13"), 64.4, 68.9);
const b13 = depth(F, $("#b13-rig"), { src: A("gallery/ca-terrace.jpg"), subject: [44, 50, 40, 46], front: "bottom", par: [1, 1.5, 2.3] });
b13.blurBack = 2; b13.blurFront = 4;
move(tl, b13, 64.4, 68.9, { z: 0.0, x: 90, y: 14 }, { z: 0.12, x: -90, y: -14 }, "none");
tl.fromTo("#b13-text", { x: 20 }, { x: -20, duration: 4.5, ease: "none", immediateRender: true }, 64.4);
tl.fromTo("#b13-back", { x: 40, opacity: 0 }, { x: 0, opacity: 0.4, duration: 0.8, ease: "power3.inOut", immediateRender: true }, 64.5);
tl.fromTo("#b13-front", { x: -40, opacity: 0 }, { x: 0, opacity: 0.9, duration: 0.8, ease: "power3.inOut", immediateRender: true }, 64.5);
const w13 = wordmark($("#b13-word"));
tl.fromTo(w13, { yPercent: 110 }, { yPercent: 0, duration: 0.9, stagger: 0.03, ease: "expo.out", immediateRender: true }, 64.9);
// the URL opens by tracking and resolves on the impact (66.3, cues.json)
track(tl, $("#b13-url"), 65.1, { dur: 1.2, from: -0.2, to: 0.16 });
wipe(tl, $("#b13-rule"), 66.3, { dur: 0.6 });
track(tl, $("#b13-omni"), 66.5, { dur: 1.1, from: -0.2, to: 0.28 });
tl.fromTo("#b13-cam", { scale: 1.12 }, { scale: 0.98, duration: 4.3, ease: "power2.out", immediateRender: true }, 64.5);
tl.to(["#b13-cam", "#b13-rig"], { opacity: 0, duration: 0.9, ease: "power1.in" }, 67.9);
