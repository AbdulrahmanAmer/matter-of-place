// doors.mjs: renders the two doors the email houses open on (app/public/email/door-*.{gif,png}).
//   node launch/email-doors/doors.mjs day <workDir>     Afternoon's door by day, from afternoon-door.html
//   node launch/email-doors/doors.mjs night <workDir>   Threshold's door at night, from the film's own 3D hall
//   node launch/email-doors/doors.mjs sheet <out.png> <tau,...> [night]   frames side by side, for looking
// Each writes its frames to <workDir>, builds the GIF with ffmpeg (plays once, frame 1 held, the last frame held) and
// copies it, with the stills, to app/public/email/. Uses launch's puppeteer-core and a Chrome (CHROME_PATH or the
// puppeteer cache, launch/engine/chrome.mjs); `night` needs the GPU (WebGL), about 20 s on this laptop.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChrome } from "../engine/chrome.mjs";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const here = dirname(fileURLToPath(import.meta.url));
const publicEmail = resolve(here, "../../app/public/email");
const PLAYER = resolve(here, "../brand-film-kit/reference/product-launch/matter-of-place-product-launch.html");

const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });

/** Frames in order, each held 1/fps, the first and the last held longer; a palette GIF that plays once. */
function gif({ frames, out, work, w, h, fps, holdFirst, holdLast, colors, dither, prep }) {
  // The scratch of the GIF stays in the work folder, never beside the picture in app/public/email.
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const list = frames.map((src, i) => {
    const p = join(work, `p_${String(i).padStart(4, "0")}.png`);
    ff(["-i", src, "-vf", `${prep ? `${prep},` : ""}scale=${w}:${h}:flags=lanczos,format=rgb24`, "-frames:v", "1", p]);
    const dur = (1 + (i === 0 ? holdFirst * fps : 0) + (i === frames.length - 1 ? holdLast * fps : 0)) / fps;
    return `file '${p.replace(/\\/g, "/")}'\nduration ${dur.toFixed(4)}`;
  });
  const listFile = join(work, "list.txt");
  writeFileSync(listFile, `${list.join("\n")}\nfile '${join(work, `p_${String(frames.length - 1).padStart(4, "0")}.png`).replace(/\\/g, "/")}'\n`);
  const palette = join(work, "palette.png");
  ff(["-f", "concat", "-safe", "0", "-i", listFile, "-vf", `palettegen=max_colors=${colors}:stats_mode=full:reserve_transparent=0`, palette]);
  ff(["-f", "concat", "-safe", "0", "-i", listFile, "-i", palette, "-lavfi", `[0:v][1:v]paletteuse=dither=${dither}:diff_mode=rectangle`, "-loop", "-1", out]);
  console.log(`${out}: ${frames.length} frames, ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

async function page(url, viewport) {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: true,
    protocolTimeout: 0,
    args: ["--allow-file-access-from-files", "--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
  });
  const tab = await browser.newPage();
  tab.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await tab.setViewport(viewport);
  await tab.goto(url, { waitUntil: "load", timeout: 120000 });
  return { browser, tab };
}

/** Afternoon: the door in a Bone wall, 36 frames at 2x; the still for Apple Mail's dark mode. */
async function day(workDir) {
  mkdirSync(workDir, { recursive: true });
  const { browser, tab } = await page(pathToFileURL(join(here, "afternoon-door.html")).href, { width: 1400, height: 900 });
  const shot = (s) =>
    tab.evaluate((s) => { window.size(600, 300, 2); window.render(s); return document.getElementById("c").toDataURL("image/png").split(",")[1]; }, s);
  const frames = [];
  for (let i = 0; i < 36; i++) {
    const file = join(workDir, `d_${String(i).padStart(4, "0")}.png`);
    writeFileSync(file, Buffer.from(await shot({ tau: i / 35 }), "base64"));
    frames.push(file);
  }
  writeFileSync(join(publicEmail, "door-day-dark.png"), Buffer.from(await shot({ tau: 1, night: true }), "base64"));
  await browser.close();
  gif({ frames, out: join(publicEmail, "door-day.gif"), work: join(workDir, "gif"), w: 1200, h: 600, fps: 15, holdFirst: 1.4, holdLast: 3.0, colors: 160, dither: "sierra2_4a" });
}

/** Threshold: the film's hall from the closed mark to the open door, 40 frames, dollying in (film-door-zoom). */
async function night(workDir) {
  mkdirSync(workDir, { recursive: true });
  const [W, H, SUB, N] = [1600, 900, 8, 40];
  const { browser, tab } = await page(pathToFileURL(PLAYER).href, { width: 1280, height: 800 });
  await tab.waitForFunction(() => window.Film && document.fonts.status === "loaded", { timeout: 120000 });
  await tab.evaluate(async ([W, H]) => {
    await Promise.all(Film.fonts.map((fn) => document.fonts.load(fn, "Aa")));
    const gl = document.createElement("canvas"); gl.width = W; gl.height = H; document.body.appendChild(gl);
    Film.init(gl, { keep: true, aa: false, soft: false }); Film.size(W, H); Film.setRatio(1);
    window.__gl = gl;
    const acc = document.createElement("canvas"); acc.width = W; acc.height = H; window.__acc = acc;
  }, [W, H]);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const tau = i / (N - 1);
    const b64 = await tab.evaluate(([tau, SUB]) => {
      const gl = window.__gl, acc = window.__acc, x = acc.getContext("2d");
      const hal = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
      const io = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
      const sm = (a, b, u) => { const k = Math.min(1, Math.max(0, (u - a) / (b - a))); return k * k * (3 - 2 * k); };
      const D = Film._dbg(), cam = D.cam;
      const s = 28.95 - 1.5 * sm(0.22, 0.97, tau);   // the door: the film's lockup played backwards, closed mark to open door
      // The dolly runs from 100 to 60 units: the framing of the committed door-night.gif (its first and last frames
      // measured against these, 2026-10-15), an exponential path so the zoom feels even, eased at both ends.
      const e = io(tau), z = 100 * Math.pow(60 / 100, e), y = 5.75 + (4.6 - 5.75) * e, look = 5.75 + (5.35 - 5.75) * e;
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over";
      for (let k = 0; k < SUB; k++) {
        const j = SUB > 1 ? { x: hal(k + 1, 2) - 0.5, y: hal(k + 1, 3) - 0.5, u: hal(k + 1, 19) * 2 - 1, v: hal(k + 1, 29) * 2 - 1, w: hal(k + 1, 23), i: k } : {};
        Film.setJitter(j); Film.update(s);
        const H0 = D.WORLD.H;
        if (H0.txtL) { H0.txtL.m.visible = false; H0.txtR.m.visible = false; }
        if (H0.dust) for (const d of H0.dust) d.pts.visible = false;
        cam.position.set(0, y, z); cam.up.set(0, 1, 0); cam.lookAt(0, look, 0); cam.fov = 20;
        cam.setViewOffset(1920, 1080, j.x || 0, j.y || 0, 1920, 1080); cam.updateMatrixWorld(true);
        D.rawRender();
        x.globalAlpha = 1 / (k + 1); x.drawImage(gl, 0, 0);
      }
      Film.setJitter({}); x.globalAlpha = 1;
      return acc.toDataURL("image/png").split(",")[1];
    }, [tau, SUB]);
    const file = join(workDir, `z_${String(i).padStart(4, "0")}.png`);
    writeFileSync(file, Buffer.from(b64, "base64"));
    frames.push(file);
  }
  await browser.close();
  // The vignette lands on Obsidian exactly, so the picture has no edge in its band.
  const vignette =
    "geq=r='17+(r(X,Y)-17)*M':g='17+(g(X,Y)-17)*M':b='15+(b(X,Y)-15)*M'".replaceAll(
      "M",
      "(clip((1-sqrt(pow((X-0.5*W)/(0.5*W),2)+pow((Y-0.47*H)/(0.56*H),2)))/(1-0.42),0,1)*clip((1-sqrt(pow((X-0.5*W)/(0.5*W),2)+pow((Y-0.47*H)/(0.56*H),2)))/(1-0.42),0,1)*(3-2*clip((1-sqrt(pow((X-0.5*W)/(0.5*W),2)+pow((Y-0.47*H)/(0.56*H),2)))/(1-0.42),0,1)))",
    );
  gif({
    frames,
    out: join(publicEmail, "door-night.gif"),
    work: join(workDir, "gif"),
    w: 600,
    h: 440,
    fps: 15,
    holdFirst: 1.2,
    holdLast: 3.0,
    colors: 96,
    dither: "bayer:bayer_scale=4",
    prep: `crop=1200:880:200:10,format=rgb24,${vignette}`,
  });
}

async function sheet(out, taus, isNight) {
  const { browser, tab } = await page(pathToFileURL(join(here, "afternoon-door.html")).href, { width: 1400, height: 900 });
  const b64 = await tab.evaluate((taus, night) => {
    const cw = 600, ch = 300, pad = 16, cols = 2, rows = Math.ceil(taus.length / cols);
    const s = document.createElement("canvas"); s.width = cols * (cw + pad) + pad; s.height = rows * (ch + pad) + pad;
    const g = s.getContext("2d"); g.fillStyle = "#8b877f"; g.fillRect(0, 0, s.width, s.height);
    taus.forEach((t, i) => { window.size(cw, ch, 1); window.render({ tau: t, night }); g.drawImage(document.getElementById("c"), pad + (i % cols) * (cw + pad), pad + Math.floor(i / cols) * (ch + pad)); });
    return s.toDataURL("image/png").split(",")[1];
  }, taus, isNight);
  writeFileSync(out, Buffer.from(b64, "base64"));
  await browser.close();
}

const [mode, target, a3, a4] = process.argv.slice(2);
if (mode === "day") await day(resolve(target));
else if (mode === "night") await night(resolve(target));
else if (mode === "sheet") await sheet(resolve(target), a3.split(",").map(Number), a4 === "night");
else {
  console.error("usage: doors.mjs day|night <workDir> | sheet <out.png> <tau,...> [night]");
  process.exit(64);
}
