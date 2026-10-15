// The motion half of `scripts/email-gallery.ts`: the opening of one email as a strip of still frames, so the motion
// Apple Mail plays can be looked at and checked (operator, 2026-10-15: "it will work with the motion stuff if it was
// written properly"). Node, not Bun (see email-shots-page.mjs).
//   node scripts/lib/email-gallery-motion.mjs <page.html> <strip.png>
// It opens the page in Edge at 640 px, pauses every CSS animation at each of the times below with the Web Animations
// API (the harness's script, never the email's), photographs the head of the page and lays the frames side by side,
// each over its time. It also opens the page with reduced motion asked for and requires that no animation runs.
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const TIMES = [0, 300, 600, 900, 1300, 2200];
const FRAME = { width: 640, height: 400 };
const LABEL = 28;

const [page, strip] = process.argv.slice(2);
if (page === undefined || strip === undefined) {
  console.error("usage: email-gallery-motion.mjs <page.html> <strip.png>");
  process.exit(64);
}

/** @param {number} ms */
const seek = (ms) =>
  `document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ${String(ms)}; }); document.getAnimations().length`;

const browser = await chromium.launch({ channel: "msedge" });
try {
  const tab = await browser.newPage({ viewport: FRAME, reducedMotion: "no-preference" });
  await tab.goto(pathToFileURL(page).href, { waitUntil: "load" });
  const frames = [];
  for (const ms of TIMES) {
    const running = /** @type {number} */ (await tab.evaluate(seek(ms)));
    if (running === 0) throw new Error("no animation runs with motion allowed");
    frames.push(await tab.screenshot({ clip: { x: 0, y: 0, ...FRAME } }));
  }
  const calm = await browser.newPage({ viewport: FRAME, reducedMotion: "reduce" });
  await calm.goto(pathToFileURL(page).href, { waitUntil: "load" });
  const still = /** @type {number} */ (await calm.evaluate("document.getAnimations().length"));
  if (still !== 0) throw new Error(`${String(still)} animations run with reduced motion asked for`);
  const labels = TIMES.map((ms) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(FRAME.width)}" height="${String(LABEL)}"><rect width="100%" height="100%" fill="#11110f"/><text x="12" y="19" font-family="Segoe UI, Arial" font-size="13" letter-spacing="2" fill="#c9c0b2">${(ms / 1000).toFixed(1)} S</text></svg>`,
    ),
  );
  const cell = FRAME.height + LABEL;
  await sharp({
    create: {
      width: FRAME.width * 3,
      height: cell * 2,
      channels: 3,
      background: "#11110f",
    },
  })
    .composite(
      frames.flatMap((frame, index) => {
        const left = (index % 3) * FRAME.width;
        const top = Math.floor(index / 3) * cell;
        return [
          { input: labels[index] ?? Buffer.alloc(0), left, top },
          { input: frame, left, top: top + LABEL },
        ];
      }),
    )
    .png({ compressionLevel: 9 })
    .toFile(strip);
  console.log(`motion ${String(TIMES.length)} frames, none with reduced motion: ${strip}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
