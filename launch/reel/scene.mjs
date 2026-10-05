// Matter of Place, reel. One GSAP master timeline in absolute seconds, 18 s at 1080x1920 (STORYBOARD.md).
// Reads ?spec=<path>&cues=<path>; draws only the strings of spec.copy and the photographs of spec.shots.
import { film, maskIn, maskOut, track, wipe, black, shot, depth, move, decode } from "/launch/engine/runtime/film.js";

const params = new URLSearchParams(location.search);
const spec = await (await fetch(params.get("spec"))).json();
const { copy, shots } = spec;
const $ = (selector) => document.querySelector(selector);

const SERIF = '"Cormorant Garamond"';
await Promise.all([`400 100px ${SERIF}`, `500 100px ${SERIF}`, '400 30px "Jost"'].map((font) => document.fonts.load(font)));

const F = film({ duration: 18, fonts: ["300 1em Jost", "400 1em Cormorant Garamond"], cues: params.get("cues") });
const tl = F.tl;

// ---------------------------------------------------------------- helpers
// The legibility layer under type set over a photograph: solid Obsidian at one fixed opacity (functional). With a box it
// is a local pool behind the type, its edge softened by a blur, and the rest of the photograph keeps its own light.
function scrim(parent, opacity, box) {
  const wrap = document.createElement("div");
  wrap.className = "scrim";
  const layer = document.createElement("div");
  layer.style.opacity = String(opacity);
  if (box) Object.assign(layer.style, { right: "auto", bottom: "auto", left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, filter: `blur(${box.blur}px)` });
  wrap.append(layer);
  parent.append(wrap);
  return wrap;
}

// M11 light sweep: a solid Bone layer, softened by a 60 px blur, crossing the frame diagonally once.
function lightSweep(parent, at) {
  const beam = document.createElement("div");
  Object.assign(beam.style, { position: "absolute", zIndex: "1", left: "0", top: "-40px", width: "560px", height: "2000px", background: "var(--secondary)", filter: "blur(60px)", opacity: "0.1", pointerEvents: "none" });
  parent.append(beam);
  tl.fromTo(beam, { x: -900, y: -200, rotation: 32 }, { x: 1900, y: 200, rotation: 32, duration: 1.8, ease: "none", immediateRender: true }, at);
}

// M10 grid assemble: tiles arrive from slight offsets into a strict grid; the only spring of the reel lives here.
function gridAssemble(tiles, at) {
  const drift = [[-16, -12], [16, -12], [-16, 0], [16, 0], [-16, 12], [16, 12]];
  tiles.forEach(({ el, x, y }, k) => {
    const start = at + k * 0.1;
    tl.fromTo(el, { x: x + drift[k][0], y: y + drift[k][1] }, { x, y, duration: 1.1, ease: "back.out(1.2)", immediateRender: true }, start);
    tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, ease: "power2.out", immediateRender: true }, start);
  });
}

// One camera drives every copy of a photograph (the two halves of an M9 split slide share it).
function rigs(roots, src, options) {
  const [first, ...rest] = roots;
  const cam = depth(F, first, { src, ...options });
  for (const root of rest) depth(F, root, { src, ...options, cam });
  return cam;
}
const halvesOf = (id) => [$(`#${id}-t .rig`), $(`#${id}-b .rig`)];
const dolly = (cam, t0, t1, from, to) => move(tl, cam, t0, t1, from, to, "none");

// M9 split slide: the frame divides into a top and a bottom panel that slide opposite ways.
function split(id, at) {
  tl.fromTo(`#${id}-t`, { yPercent: 0 }, { yPercent: -58, duration: 0.55, ease: "power3.inOut", immediateRender: true }, at);
  tl.fromTo(`#${id}-b`, { yPercent: 0 }, { yPercent: 58, duration: 0.55, ease: "power3.inOut", immediateRender: true }, at);
}

// Text sizing from the loaded fonts: a line that is too wide shrinks, a title breaks into balanced lines.
function fitText(el, maxWidth, probe = el) {
  const width = probe.getBoundingClientRect().width;
  if (width > maxWidth) el.style.fontSize = `${((parseFloat(getComputedStyle(el).fontSize) * maxWidth) / width).toFixed(2)}px`;
}
const ruler = document.createElement("canvas").getContext("2d");
function breakLines(text, font, maxWidth) {
  ruler.font = font;
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && ruler.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  return line ? [...lines, line] : lines;
}
function titleLines(text, maxWidth) {
  for (const size of [112, 96, 84, 72]) {
    const font = `400 ${size}px ${SERIF}`;
    const count = breakLines(text, font, maxWidth).length;
    if (count > 3 && size > 72) continue;
    let width = maxWidth;
    while (width > maxWidth / 2 && breakLines(text, font, width - 8).length === count) width -= 8;
    return { size, lines: breakLines(text, font, width) };
  }
}

const imageOf = (index) => shots[index].src;
const PAR = [1, 1.25, 1.5];
const PAR_ROOM = [1, 1.15, 1.3];
const PAR_SOFT = [1, 1.1, 1.2];

// The legibility layer shows only while type is on the photograph.
function veil(layers, tin, tout) {
  tl.fromTo(layers, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: "power1.out", immediateRender: true }, tin);
  tl.to(layers, { autoAlpha: 0, duration: 0.5, ease: "power1.out" }, tout);
}

// ---------------------------------------------------------------- beat 1 · 0.0 to 2.6 · M6 push, M8 rack focus, M2 label
// the first photograph is on screen from frame 0, so a thumbnail taken from the first frame is the picture
tl.set($("#s1"), { autoAlpha: 0 }, 2.6);
const cam1 = rigs(halvesOf("s1"), imageOf(0), { subject: [50, 58, 36, 42], front: "bottom", par: PAR_SOFT, align: 0.2 });
cam1.blurBack = 2;
cam1.blurFront = 2;
dolly(cam1, 0, 2.6, { z: 0, x: 24, y: 10 }, { z: 0.09, x: -24, y: -10 });
tl.fromTo(cam1, { blurSubject: 8 }, { blurSubject: 0, duration: 1, ease: "power2.out", immediateRender: true }, 0);
scrim($("#s1-t"), 0.2);
scrim($("#s1-b"), 0.2);
$("#label").textContent = copy.location;
fitText($("#label"), 920);
track(tl, $("#label"), 0.3);
tl.to($("#label"), { opacity: 0, duration: 0.3, ease: "power1.out" }, 1.8);
split("s1", 2.0);

// ---------------------------------------------------------------- beat 3 · 2.0 to 5.4 · M7 crane, M1 title, M3 weight, hard cut out
shot(tl, $("#s2"), 2.0, 5.4);
const cam2 = rigs(halvesOf("s2"), imageOf(1), { subject: [48, 55, 38, 42], front: "sides", par: PAR_ROOM, align: 0.5 });
dolly(cam2, 2.0, 5.4, { z: 0.04, y: 30, r: -0.8 }, { z: 0.08, y: -30, r: 0.8 });
// the pool is drawn in both panels, so the seam between them shows no edge
const pool2 = { x: -100, y: 960, w: 1000, h: 520, blur: 90 };
const veil2 = [scrim($("#s2-t"), 0.16), scrim($("#s2-b"), 0.16), scrim($("#s2-t"), 0.6, pool2), scrim($("#s2-b"), 0.6, pool2)];
veil(veil2, 2.1, 5.4);
const { size, lines } = titleLines(copy.title, 920);
$("#title").style.fontSize = `${size}px`;
for (const text of lines) {
  const ln = document.createElement("span");
  ln.className = "ln";
  const word = document.createElement("span");
  word.className = "w";
  for (const weightClass of ["w4", "w5"]) {
    const face = document.createElement("span");
    face.className = weightClass;
    face.textContent = text;
    word.append(face);
  }
  ln.append(word);
  $("#title").append(ln);
}
maskIn(tl, $("#title"), 2.65, { dur: 0.8 });
// M3 weight 400 to 500: the heavier face fades in over the lighter one, so the line never dims
tl.fromTo("#title .w5", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "none", immediateRender: true }, 3.15);
tl.set("#title .w4", { opacity: 0 }, 3.75);
// the block sinks while the picture cranes up, so the two move against each other
tl.fromTo($("#title"), { y: -10 }, { y: 30, duration: 2.2, ease: "none", immediateRender: true }, 2.65);
maskOut(tl, $("#title"), 4.65, { dur: 0.5 });

// ---------------------------------------------------------------- beat 5 · 5.4 to 8.2 · M6 push, M4 rule, M1 facts
shot(tl, $("#s3"), 5.4, 8.2);
const cam3 = rigs([$("#s3-rig")], imageOf(2), { subject: [50, 58, 36, 42], front: "bottom", par: PAR, align: 0.3 });
dolly(cam3, 5.4, 8.2, { z: 0, x: 30, y: 14 }, { z: 0.09, x: -30, y: -10 });
// M8: the foreground deck pulls into focus while the camera is already moving
tl.fromTo(cam3, { blurFront: 7 }, { blurFront: 0, duration: 1.1, ease: "power2.out", immediateRender: true }, 5.4);
scrim($("#s3"), 0.1);
veil([scrim($("#s3"), 0.5, { x: -100, y: 1150, w: 1280, h: 420, blur: 90 })], 5.5, 7.3);
$("#price .ln > span").textContent = copy.price;
$("#facts .ln > span").textContent = copy.facts;
fitText($("#price"), 920);
fitText($("#facts"), 920);
maskIn(tl, $("#price"), 5.65, { dur: 0.8 });
wipe(tl, $("#rule"), 5.95, { dur: 0.8 });
maskIn(tl, $("#facts"), 6.2, { dur: 0.7 });
maskOut(tl, $("#price"), 7.45, { dur: 0.55 });
maskOut(tl, $("#facts"), 7.5, { dur: 0.55 });
tl.to($("#rule"), { opacity: 0, duration: 0.4, ease: "power1.out" }, 7.5);

// ---------------------------------------------------------------- beat 6 · 8.2 to 8.75 · M13 hard cut to black, the first silence beat
black(tl, $("#cut"), 8.2, 6);

// ---------------------------------------------------------------- beat 7 · 8.4 to 12.4 · M10 grid, one tile grows, M6, hard cut out
shot(tl, $("#s7"), 8.4, 11.3);
const PUSH = 1.035;
const RISE = -36;
const tiles = shots.slice(4).map((tileShot, k) => {
  const el = document.createElement("div");
  el.className = "tile";
  const inner = document.createElement("div");
  inner.style.backgroundImage = `url("${tileShot.src}")`;
  el.append(inner);
  F.waitFor(decode(tileShot.src));
  $("#grid").append(el);
  // each picture settles from 22 percent larger to its tile over the grid's life, so no settled tile is a still
  tl.fromTo(inner, { scale: 1.22, x: k % 2 ? 26 : -26, y: k < 3 ? 20 : -20 }, { scale: 1, x: 0, y: 0, duration: 2.6, ease: "none", immediateRender: true }, 8.7);
  return { el, x: 54 + (k % 2) * 504, y: 321 + Math.floor(k / 2) * 400 };
});
gridAssemble(tiles, 8.7);
tl.fromTo($("#grid"), { scale: 1, y: 0 }, { scale: PUSH, y: RISE, duration: 2.6, ease: "none", immediateRender: true }, 8.7);
// the last tile grows to the box the full-frame rig draws (the frame plus 10 % on every side), seen through the grid's push
const last = tiles[tiles.length - 1];
tl.to(tiles.slice(0, -1).map(({ el }) => el), { autoAlpha: 0.3, duration: 0.9, ease: "power2.out" }, 10.3);
tl.fromTo(last.el, { x: last.x, y: last.y, width: 468, height: 366 }, { x: 540 + (-108 - 540) / PUSH, y: 960 + (-192 - 960 - RISE) / PUSH, width: 1296 / PUSH, height: 2304 / PUSH, duration: 1.0, ease: "power3.inOut", immediateRender: false }, 10.3);

shot(tl, $("#s7b"), 11.3, 12.4);
const cam7 = rigs([$("#s7b-rig")], imageOf(9), { subject: [50, 55, 36, 42], front: "bottom", par: PAR_SOFT, align: 0 });
dolly(cam7, 11.3, 12.4, { z: 0, x: 0, y: 0 }, { z: 0.09, x: -20, y: -8 });

// ---------------------------------------------------------------- beat 8 · 12.4 to 18.0 · M5 lock, M1 site, M2 credit, M11
shot(tl, $("#s8"), 12.4);
const cam8 = rigs([$("#s8-rig")], imageOf(3), { subject: [50, 58, 36, 42], front: "bottom", par: PAR_SOFT, align: 0 });
// the last shot runs 5.6 s, so its 9 percent push is slow: M7 crane (80 px each way, 0.8 degrees) and a 30 px drift keep the picture moving to the last frame
dolly(cam8, 12.4, 18, { z: 0, x: 30, y: 80, r: -0.8 }, { z: 0.09, x: -30, y: -80, r: 0.8 });
const endScrim = scrim($("#s8"), 0.1);
const endPool = scrim($("#s8"), 0.5, { x: 100, y: 900, w: 880, h: 580, blur: 100 });
tl.fromTo([endScrim, endPool], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: "power1.out", immediateRender: true }, 13.6);
lightSweep($("#s8"), 15.9);

$("#site .ln > span").textContent = copy.site;
$("#credit").textContent = copy.credit;
F.waitFor(decode($("#word img").src));
// M5, fast: the two planes close on each other, the opening appears last
tl.fromTo("#emblem-back", { x: 46, opacity: 0 }, { x: 0, opacity: 0.4, duration: 0.8, ease: "power3.inOut", immediateRender: true }, 14.2);
tl.fromTo("#emblem-front", { x: -46, opacity: 0 }, { x: 0, opacity: 0.9, duration: 0.8, ease: "power3.inOut", immediateRender: true }, 14.2);
maskIn(tl, $("#word"), 14.75, { dur: 0.8 });
maskIn(tl, $("#site"), 15.0, { dur: 0.7 });
track(tl, $("#credit"), 15.5, { dur: 1.0, from: -0.2, to: 0.28 });
// the lock rises 20 px to the last frame, so it moves with the picture instead of freezing on it
tl.fromTo(".endcard", { y: 10 }, { y: -10, duration: 3.9, ease: "none", immediateRender: true }, 14.1);
