// Matter of Place, reel. One GSAP master timeline in absolute seconds, 18 s at 1080x1920 (STORYBOARD.md).
// Reads ?spec=<path>&cues=<path>; draws only the strings of spec.copy and the photographs of spec.shots.
import { film, maskIn, maskOut, track, weight, wipe, black, shot, depth, move, decode } from "/launch/engine/runtime/film.js";

const params = new URLSearchParams(location.search);
const spec = await (await fetch(params.get("spec"))).json();
const { copy, shots } = spec;
const $ = (selector) => document.querySelector(selector);

const SERIF = '"Cormorant Garamond"';
await Promise.all([`400 100px ${SERIF}`, `500 100px ${SERIF}`, '400 30px "Jost"'].map((font) => document.fonts.load(font)));

const F = film({ duration: 18, fonts: ["300 1em Jost", "400 1em Cormorant Garamond"], cues: params.get("cues") });
const tl = F.tl;

// ---------------------------------------------------------------- helpers
// The legibility layer under type set over a photograph: solid Obsidian at one fixed opacity (functional).
function scrim(parent, opacity) {
  const wrap = document.createElement("div");
  wrap.className = "scrim";
  const layer = document.createElement("div");
  layer.style.opacity = String(opacity);
  wrap.append(layer);
  parent.append(wrap);
  return wrap;
}

// M11 light sweep: a solid Bone layer, softened by a 60 px blur, crossing the frame diagonally once.
function lightSweep(parent, at) {
  const beam = document.createElement("div");
  Object.assign(beam.style, { position: "absolute", zIndex: "1", left: "0", top: "-40px", width: "340px", height: "2000px", background: "var(--secondary)", filter: "blur(60px)", opacity: "0.18", pointerEvents: "none" });
  parent.append(beam);
  tl.fromTo(beam, { x: -900, y: -200, rotation: 22 }, { x: 1900, y: 200, rotation: 22, duration: 1.8, ease: "none", immediateRender: true }, at);
}

// M10 grid assemble: tiles arrive from slight offsets into a strict grid; the only spring of the reel lives here.
function gridAssemble(tiles, at) {
  const order = [2, 3, 0, 1, 4, 5];
  const drift = [[-40, -30], [40, -30], [-40, 0], [40, 0], [-40, 30], [40, 30]];
  tiles.forEach(({ el, x, y }, k) => {
    const start = at + order.indexOf(k) * 0.075;
    tl.fromTo(el, { x: x + drift[k][0], y: y + drift[k][1], scale: 0.92 }, { x, y, scale: 1, duration: 1.1, ease: "back.out(1.2)", immediateRender: true }, start);
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
  tl.fromTo(`#${id}-t`, { yPercent: 0 }, { yPercent: -52, duration: 0.7, ease: "power3.inOut", immediateRender: true }, at);
  tl.fromTo(`#${id}-b`, { yPercent: 0 }, { yPercent: 52, duration: 0.7, ease: "power3.inOut", immediateRender: true }, at);
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

// ---------------------------------------------------------------- beat 1 · 0.0 to 3.7 · M6 push, M8 rack focus, M2 label
shot(tl, $("#s1"), 0, 3.7);
const cam1 = rigs(halvesOf("s1"), imageOf(0), { subject: [50, 58, 36, 42], front: "bottom", par: [1, 1.45, 2.1], align: 0.2 });
cam1.blurBack = 2;
cam1.blurFront = 2;
dolly(cam1, 0, 3.7, { z: 0, x: 24, y: 10 }, { z: 0.085, x: -24, y: -10 });
tl.fromTo(cam1, { blurSubject: 8 }, { blurSubject: 0, duration: 1, ease: "power2.out", immediateRender: true }, 0);
scrim($("#s1-t"), 0.28);
scrim($("#s1-b"), 0.28);
$("#label").textContent = copy.location;
fitText($("#label"), 920);
track(tl, $("#label"), 0.3);
split("s1", 3.0);

// ---------------------------------------------------------------- beat 3 · 3.0 to 7.7 · M7 crane, M1 title, M3 weight
shot(tl, $("#s2"), 3.0, 7.7);
const cam2 = rigs(halvesOf("s2"), imageOf(1), { subject: [48, 55, 38, 42], front: "sides", par: [1, 1.4, 2.0], align: 0.5 });
dolly(cam2, 3.0, 7.7, { z: 0.03, y: 70, r: -1.2 }, { z: 0.07, y: -70, r: 1.2 });
scrim($("#s2-t"), 0.3);
scrim($("#s2-b"), 0.3);
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
maskIn(tl, $("#title"), 3.85, { dur: 0.8 });
weight(tl, $("#title"), 4.35, { dur: 0.6 });
maskOut(tl, $("#title"), 6.4, { dur: 0.55 });
split("s2", 7.0);

// ---------------------------------------------------------------- beat 5 · 7.0 to 11.0 · M6 push, M4 rule, M1 facts
shot(tl, $("#s3"), 7.0, 11.0);
const cam3 = rigs([$("#s3-rig")], imageOf(2), { subject: [50, 58, 36, 42], front: "bottom", par: [1, 1.45, 2.1], align: 0.3 });
dolly(cam3, 7.0, 11.0, { z: 0, x: 30, y: 14 }, { z: 0.075, x: -30, y: -10 });
scrim($("#s3"), 0.3);
$("#facts .ln > span").textContent = copy.facts;
fitText($("#facts"), 920);
wipe(tl, $("#rule"), 7.9, { dur: 0.8 });
maskIn(tl, $("#facts"), 8.2, { dur: 0.7 });
maskOut(tl, $("#facts"), 10.3, { dur: 0.55 });
tl.to($("#rule"), { opacity: 0, duration: 0.4, ease: "power1.out" }, 10.3);

// ---------------------------------------------------------------- beat 6 · 11.0 to 11.2 · M13 hard cut to black
black(tl, $("#cut"), 11.0, 6);

// ---------------------------------------------------------------- beat 7 · 11.2 to 15.4 · M10 grid, one tile grows, M6, M9
shot(tl, $("#s7"), 11.2, 13.6);
const PUSH = 1.035;
const tiles = shots.slice(4).map((tileShot, k) => {
  const el = document.createElement("div");
  el.className = "tile";
  el.style.backgroundImage = `url("${tileShot.src}")`;
  F.waitFor(decode(tileShot.src));
  $("#grid").append(el);
  return { el, x: 60 + (k % 2) * 492, y: 126 + Math.floor(k / 2) * 564 };
});
gridAssemble(tiles, 11.2);
tl.fromTo($("#grid"), { scale: 1 }, { scale: PUSH, duration: 1.5, ease: "none", immediateRender: true }, 11.2);
// the last tile grows to the box the full-frame rig draws (the frame plus 10 % on every side), seen through the grid's push
const last = tiles[tiles.length - 1];
tl.fromTo(last.el, { x: last.x, y: last.y, width: 468, height: 540 }, { x: 540 + (-108 - 540) / PUSH, y: 960 + (-192 - 960) / PUSH, width: 1296 / PUSH, height: 2304 / PUSH, duration: 0.9, ease: "power3.inOut", immediateRender: false }, 12.7);

shot(tl, $("#s7b"), 13.6, 15.4);
const cam7 = rigs(halvesOf("s7b"), imageOf(9), { subject: [50, 55, 36, 42], front: "bottom", par: [1, 1.45, 2.1], align: 0 });
dolly(cam7, 13.6, 15.4, { z: 0, x: 0, y: 0 }, { z: 0.06, x: -20, y: -8 });
split("s7b", 14.7);

// ---------------------------------------------------------------- beat 8 · 14.7 to 18.0 · M1 price and site, M5 lock, M2 credit, M11
shot(tl, $("#s8"), 14.7);
const cam8 = rigs([$("#s8-rig")], imageOf(3), { subject: [50, 58, 36, 42], front: "bottom", par: [1, 1.45, 2.1], align: 0 });
dolly(cam8, 14.7, 18, { z: 0, x: 20, y: 8 }, { z: 0.09, x: -20, y: -8 });
const endScrim = scrim($("#s8"), 0.42);
tl.fromTo(endScrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.4, ease: "power1.out", immediateRender: true }, 15.4);
lightSweep($("#s8"), 16.2);

$("#price .ln > span").textContent = copy.price;
fitText($("#price"), 920, $("#price .ln > span"));
$("#site .ln > span").textContent = copy.site;
$("#credit").textContent = copy.credit;
F.waitFor(decode($("#word img").src));
maskIn(tl, $("#price"), 15.5, { dur: 0.8 });
maskIn(tl, $("#site"), 15.75, { dur: 0.7 });
// M5, fast: the two planes close on each other, the opening appears last
tl.fromTo("#emblem-back", { x: 46, opacity: 0 }, { x: 0, opacity: 0.4, duration: 0.8, ease: "power3.inOut", immediateRender: true }, 15.95);
tl.fromTo("#emblem-front", { x: -46, opacity: 0 }, { x: 0, opacity: 0.9, duration: 0.8, ease: "power3.inOut", immediateRender: true }, 15.95);
maskIn(tl, $("#word"), 16.5, { dur: 0.8 });
track(tl, $("#credit"), 16.95, { dur: 1.0, from: -0.2, to: 0.28 });
