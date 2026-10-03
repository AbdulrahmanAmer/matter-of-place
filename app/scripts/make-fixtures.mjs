import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Run once, output committed (B2 step 13): the two JPEG fixtures of the image tests, from a deterministic pattern.
// `node scripts/make-fixtures.mjs` writes the same bytes every time, so a second run changes nothing in git.
// `tests/fixtures/photo.heic` is made once from photo.jpg with Python, because sharp's libvips cannot encode HEIC:
// `python -m pip install --user pillow-heif`, then Image.open(photo.jpg).resize((600, 400)).save(photo.heic) after
// `register_heif_opener()`.
const WIDTH = 2400;
const HEIGHT = 1600;
const GRID = 40;

/** A linear gradient under a 40 px grid: no randomness, so the encoder sees the same pixels on every run. */
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(WIDTH)}" height="${String(HEIGHT)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#11110f"/>
      <stop offset="1" stop-color="#eeeae1"/>
    </linearGradient>
    <pattern id="grid" width="${String(GRID)}" height="${String(GRID)}" patternUnits="userSpaceOnUse">
      <path d="M ${String(GRID)} 0 L 0 0 0 ${String(GRID)}" fill="none" stroke="#575751" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
</svg>`;

// Camera and GPS EXIF: the shape of a phone photograph taken at a private home, which `stripExif` must remove.
const EXIF = {
  IFD0: { Make: "Matter of Place", Model: "Fixture 1" },
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "34/1 3/1 8/1",
    GPSLongitudeRef: "W",
    GPSLongitude: "118/1 14/1 37/1",
  },
};

/** @param {string} name */
const fixture = (name) => fileURLToPath(new URL(`../tests/fixtures/${name}`, import.meta.url));
const picture = () => sharp(Buffer.from(PICTURE)).jpeg({ quality: 90 });

await writeFile(fixture("photo.jpg"), await picture().toBuffer());
await writeFile(fixture("photo-gps.jpg"), await picture().withExif(EXIF).toBuffer());
