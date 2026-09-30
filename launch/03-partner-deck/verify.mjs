// Counts slides, internal slide links, notes pages and URL links in the built deck.
import JSZip from "jszip";
import { readFileSync } from "node:fs";

const z = await JSZip.loadAsync(readFileSync(new URL("./matter-of-place-for-partners.pptx", import.meta.url)));
const names = Object.keys(z.files);
const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)));
const notes = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
console.log(`slides: ${slides.length}  notesSlides: ${notes.length}`);
for (const s of slides) {
  const xml = await z.file(s).async("string");
  const rels = await z.file(s.replace("slides/", "slides/_rels/") + ".rels").async("string");
  const toSlide = [...rels.matchAll(/Type="[^"]*\/slide" Target="([^"]+)"/g)].map((m) => m[1]);
  const urls = [...rels.matchAll(/TargetMode="External"[^>]*|Target="(https?:[^"]+)"/g)].map((m) => m[1]).filter(Boolean);
  const jumps = (xml.match(/ppaction:\/\/hlinksldjump/g) || []).length;
  console.log(`${s.split("/").pop().padEnd(12)} hlinksldjump ${jumps}  slide targets [${toSlide.join(", ")}]  urls [${urls.join(", ")}]`);
}
