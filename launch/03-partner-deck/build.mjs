// Partner deck: node build.mjs -> matter-of-place-for-partners.pptx
// Content comes from ../shared/exposure.json (generated from src/data/exposure.ts by extract-exposure.mjs).
// Fonts: Cormorant Garamond (headings) and Jost (labels, body) are referenced by name; PowerPoint falls back to
// its defaults on a machine where they are not installed.
import pptxgen from "pptxgenjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync("bun", [join(here, "../shared/extract-exposure.mjs")], { stdio: "inherit" });
const X = JSON.parse(readFileSync(join(here, "../shared/exposure.json"), "utf8"));
const A = join(here, "../../app/src/assets/").replace(/\\/g, "/");

const C = { obsidian: "11110F", bone: "EEEAE1", ivory: "F5F2EB", sandstone: "C9C0B2", mineral: "575751", warm: "8B877F" };
const SERIF = "Cormorant Garamond";
const SANS = "Jost";
const W = 13.333, H = 7.5;

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "Matter of Place";
pptx.company = "Omnikom";
pptx.title = "Matter of Place for partners";

// Section map: agenda entries link to these slide numbers.
const S = { cover: 1, agenda: 2, who: 3, standard: 4, selection: 5, feature: 6, reach: 7, campaign: 8, five: 9,
  compare: 10, distribution: 11, not: 12, faq: 13, submit: 14 };
const TOTAL = 14;

const product = (id) => X.offerings.find((o) => o.id === id);

// ---- building blocks -------------------------------------------------------------------------
function emblem(slide, x, y, h, color) {
  // Exact port of emblem.tsx: viewBox 0 0 68 76, front plane .9 opacity, back plane .4.
  const k = h / 76;
  const shape = (pts, alpha) =>
    slide.addShape(pptx.ShapeType.custGeom, {
      x: x + 8 * k, y: y + 5 * k, w: 52 * k, h: 65 * k,
      fill: { color, transparency: Math.round((1 - alpha) * 100) }, line: { type: "none" },
      points: [...pts.map(([px, py], i) => ({ x: (px - 8) * k, y: (py - 5) * k, ...(i === 0 ? { moveTo: true } : {}) })), { close: true }],
    });
  shape([[8, 5], [34, 16], [20, 21], [20, 64], [8, 70]], 0.9);
  shape([[8, 5], [60, 5], [60, 70], [48, 64], [48, 21]], 0.4);
}

function wordmark(slide, x, y, w, size, color, align = "left") {
  slide.addText(
    [
      { text: "MΛTTER ", options: { fontSize: size } },
      { text: "OF", options: { fontSize: Math.round(size * 0.58) } },
      { text: " PLΛCE", options: { fontSize: size } },
    ],
    { x, y, w, h: size / 40, fontFace: SANS, color, charSpacing: size * 0.24, align, valign: "middle", margin: 0 },
  );
}

function chrome(slide, n, { dark = false, left = 0.6, right = W - 0.55 } = {}) {
  const c = C.warm;
  slide.addText("Agenda", {
    x: right - 1.2, y: 0.32, w: 1.2, h: 0.3, fontFace: SANS, fontSize: 9, color: dark ? C.bone : C.obsidian, charSpacing: 2.5,
    align: "right", margin: 0, hyperlink: { slide: S.agenda, tooltip: "Back to the agenda" },
  });
  slide.addText("MATTER OF PLACE  ·  FOR PARTNERS", { x: left, y: H - 0.55, w: 5, h: 0.25, fontFace: SANS, fontSize: 7.5, color: c, charSpacing: 2.5, margin: 0 });
  slide.addText(`${String(n).padStart(2, "0")} / ${TOTAL}`, { x: right - 1.2, y: H - 0.55, w: 1.2, h: 0.25, fontFace: SANS, fontSize: 7.5, color: c, charSpacing: 2.5, align: "right", margin: 0 });
}

function eyebrow(slide, text, x, y, w = 6) {
  slide.addText(text.toUpperCase(), { x, y, w, h: 0.3, fontFace: SANS, fontSize: 9, bold: false, color: C.mineral, charSpacing: 3, margin: 0 });
}

function heading(slide, text, x, y, w, size = 38) {
  slide.addText(text, { x, y, w, h: size / 40 + 0.35, fontFace: SERIF, fontSize: size, color: C.obsidian, margin: 0, valign: "top" });
}

function body(slide, text, x, y, w, h, opts = {}) {
  slide.addText(text, { x, y, w, h, fontFace: SANS, fontSize: 13, color: C.mineral, margin: 0, valign: "top", lineSpacingMultiple: 1.25, ...opts });
}

function rule(slide, x, y, w) {
  slide.addShape(pptx.ShapeType.line, { x, y, w, h: 0, line: { color: C.sandstone, width: 0.75 } });
}

function ruledList(slide, lines, x, y, w, { rowH = 0.34, size = 11.5, face = SANS, color = C.obsidian } = {}) {
  lines.forEach((t, i) => {
    rule(slide, x, y + i * rowH, w);
    slide.addText(t, { x, y: y + i * rowH, w, h: rowH, fontFace: face, fontSize: size, color, margin: 0, valign: "middle" });
  });
  rule(slide, x, y + lines.length * rowH, w);
}

// A content slide: photograph on one side (full height), Bone or Ivory field on the other.
function contentSlide(n, img, side = "left", bg = C.bone) {
  const slide = pptx.addSlide();
  slide.background = { color: bg };
  const pw = 4.9;
  slide.addImage({ path: A + img, x: side === "left" ? 0 : W - pw, y: 0, w: pw, h: H, sizing: { type: "cover", w: pw, h: H } });
  const x = side === "left" ? pw + 0.8 : 0.8;
  const w = W - pw - 1.6;
  chrome(slide, n, { left: x, right: x + w });
  return { slide, x, w };
}

// ---- 1. cover -------------------------------------------------------------------------------
{
  const s = pptx.addSlide();
  s.background = { color: C.obsidian };
  s.addImage({ path: A + "tiburon.jpg", x: 0, y: 0, w: W, h: H, sizing: { type: "cover", w: W, h: H } });
  s.addShape(pptx.ShapeType.rect, { x: W - 5.6, y: 0.55, w: 5.05, h: H - 1.1, fill: { color: C.bone }, line: { type: "none" } });
  emblem(s, W - 5.0, 1.2, 0.62, C.obsidian);
  wordmark(s, W - 5.0, 2.0, 4.2, 15, C.obsidian);
  eyebrow(s, "For partners", W - 5.0, 3.2);
  heading(s, "An introduction for the first agents and brokerages invited into Matter of Place.", W - 5.0, 3.55, 4.1, 26);
  s.addText("Agenda", { x: W - 5.0, y: H - 1.25, w: 1.5, h: 0.3, fontFace: SANS, fontSize: 9, color: C.obsidian, charSpacing: 2.5, margin: 0, hyperlink: { slide: S.agenda, tooltip: "Agenda" } });
  s.addText(`01 / ${TOTAL}`, { x: W - 2.3, y: H - 1.25, w: 1.2, h: 0.3, fontFace: SANS, fontSize: 7.5, color: C.warm, charSpacing: 2.5, align: "right", margin: 0 });
  s.addNotes(
    "Welcome. This deck introduces Matter of Place to the first agents and brokerages we are inviting in. " +
      "Matter of Place is a selective real-estate media platform for existing residential property in California, New York and Florida. " +
      "Use the Agenda link on any slide to move between sections.",
  );
}

// ---- 2. agenda ------------------------------------------------------------------------------
{
  const s = pptx.addSlide();
  s.background = { color: C.ivory };
  s.addImage({ path: A + "gallery/ca-stair.jpg", x: 0, y: 0, w: 4.4, h: H, sizing: { type: "cover", w: 4.4, h: H } });
  const x = 5.2;
  chrome(s, 2, { left: x });
  eyebrow(s, "Agenda", x, 0.95);
  heading(s, "In this deck.", x, 1.3, 7, 38);
  const items = [
    ["Who we are", S.who], ["The editorial standard", S.standard], ["How selection works", S.selection],
    ["The Feature", S.feature], ["The Reach", S.reach], ["The Campaign", S.campaign], ["Five Features", S.five],
    ["The four products compared", S.compare], ["Precision distribution", S.distribution], ["What we do not do", S.not],
    ["Questions", S.faq], ["How to submit", S.submit],
  ];
  const colW = 3.5, rowH = 0.52, y0 = 2.55;
  items.forEach(([label, target], i) => {
    const col = i < 6 ? 0 : 1, row = i % 6;
    const xx = x + col * (colW + 0.4), yy = y0 + row * rowH;
    rule(s, xx, yy, colW);
    s.addText(String(i + 1).padStart(2, "0"), { x: xx, y: yy, w: 0.5, h: rowH, fontFace: SANS, fontSize: 8.5, color: C.warm, charSpacing: 2, margin: 0, valign: "middle" });
    s.addText(label, {
      x: xx + 0.5, y: yy, w: colW - 0.5, h: rowH, fontFace: SERIF, fontSize: 17, color: C.obsidian, margin: 0, valign: "middle",
      hyperlink: { slide: target, tooltip: label },
    });
  });
  rule(s, x, y0 + 6 * rowH, colW);
  rule(s, x + colW + 0.4, y0 + 6 * rowH, colW);
  s.addNotes("Each line is a link to its section. Every slide carries a small Agenda link in the top right corner that returns here.");
}

// ---- 3. who we are --------------------------------------------------------------------------
{
  const { slide: s, x, w } = contentSlide(S.who, "manhattan.jpg", "left", C.bone);
  eyebrow(s, "Who we are", x, 0.95);
  heading(s, "A selective real-estate media platform.", x, 1.3, w, 38);
  body(s, "We select, present and distribute exceptional existing residential property, through a disciplined editorial lens.", x, 2.75, w - 1, 0.9, { fontSize: 14 });
  s.addText("California  ·  New York  ·  Florida", { x, y: 3.85, w, h: 0.5, fontFace: SERIF, italic: true, fontSize: 22, color: C.obsidian, margin: 0 });
  ruledList(s, ["Existing residential property only", "Not a brokerage", "Not a listing marketplace", "Not a lead-generation service"], x, 4.65, w - 1.5);
  s.addNotes(
    "Matter of Place is editorial first. We decide what deserves attention, present it properly, and then distribute it through owned media, social, email and precision programmatic media. " +
      "We work in three markets only: California, New York and Florida, and only with existing residential property.",
  );
}

// ---- 4. editorial standard ------------------------------------------------------------------
{
  const { slide: s, x, w } = contentSlide(S.standard, "gallery/ca-stair.jpg", "right", C.ivory);
  eyebrow(s, "The editorial standard", x, 0.95);
  heading(s, "What we look for.", x, 1.3, w, 38);
  const q = X.editorialQualities;
  const colW = (w - 0.5) / 2;
  ruledList(s, q.slice(0, 4), x, 2.55, colW, { rowH: 0.62, size: 22, face: SERIF });
  ruledList(s, q.slice(4), x + colW + 0.5, 2.55, colW, { rowH: 0.62, size: 22, face: SERIF });
  s.addText("Price is not on the list.", { x, y: 5.35, w, h: 0.5, fontFace: SERIF, italic: true, fontSize: 22, color: C.obsidian, margin: 0 });
  s.addNotes(
    `The eight qualities: ${q.join(", ")}. A property's price does not decide whether it belongs in Matter of Place. ` +
      "A thoughtful, architecturally significant residence can deserve more attention than a larger, generic one.",
  );
}

// ---- 5. selection ---------------------------------------------------------------------------
{
  const { slide: s, x, w } = contentSlide(S.selection, "gallery/city-room.jpg", "left", C.bone);
  eyebrow(s, "How selection works", x, 0.95);
  heading(s, "Six steps, in this order.", x, 1.3, w, 38);
  const rowH = 0.5, y0 = 2.45;
  X.selectionSteps.forEach((st, i) => {
    const y = y0 + i * rowH;
    rule(s, x, y, w);
    s.addText(`0${i + 1}`, { x, y, w: 0.5, h: rowH, fontFace: SANS, fontSize: 8.5, color: C.warm, charSpacing: 2, margin: 0, valign: "middle" });
    s.addText(st.name, { x: x + 0.5, y, w: 2.2, h: rowH, fontFace: SERIF, fontSize: 18, color: C.obsidian, margin: 0, valign: "middle" });
    s.addText(st.text, { x: x + 2.75, y, w: w - 2.75, h: rowH, fontFace: SANS, fontSize: 11, color: C.mineral, margin: 0, valign: "middle" });
  });
  rule(s, x, y0 + 6 * rowH, w);
  body(s, "Payment never overrides editorial review. Declined properties are not charged.", x, 5.7, w, 0.5, { fontSize: 13, color: C.obsidian });
  s.addNotes(
    "Every property is reviewed against the editorial standard before any product is chosen or paid for. " +
      "Payment never overrides editorial review, and a declined property is not charged. Five Features credits are not used by declined properties.",
  );
}

// ---- 6-9. products --------------------------------------------------------------------------
const productNotes = {
  feature: "The Feature is editorial presence: a permanent, search-indexable Matter of Place page with an edited narrative, curated images, a social carousel, attribution and direct inquiry routing.",
  reach: "The Reach is our recommended product. It adds Stories, newsletter inclusion, priority scheduling, homepage or market-page rotation and programmatic campaign planning. Programmatic media spend is not included in the $695; it is billed separately.",
  campaign: "The Campaign is a deeper, multi-channel treatment over a 10 to 14 day window, including a short-form video from supplied assets and a standalone email. We suggest a media investment of $500 to $2,500 or more, billed separately. Media spend is never required.",
  "five-features": "Five Features is a package of five Feature credits for agents, teams and brokerages with several qualifying properties: $250 per property. It is not a subscription or membership. Every property is still reviewed, and a declined property does not use a credit.",
};
[["feature", S.feature, "la-jolla.jpg", "right"], ["reach", S.reach, "gallery/fl-pavilion.jpg", "left"],
 ["campaign", S.campaign, "gallery/coast-terrace.jpg", "right"], ["five-features", S.five, "brooklyn.jpg", "left"]].forEach(([id, n, img, side]) => {
  const p = product(id);
  const { slide: s, x, w } = contentSlide(n, img, side, n % 2 ? C.bone : C.ivory);
  eyebrow(s, "Property exposure", x, 0.95);
  if (p.recommended) {
    s.addText("RECOMMENDED", { x: x + 2.35, y: 0.93, w: 1.35, h: 0.28, fontFace: SANS, fontSize: 7.5, color: C.obsidian, charSpacing: 2.5, align: "center", valign: "middle", margin: 0, line: { color: C.obsidian, width: 0.75 } });
  }
  heading(s, p.name, x, 1.3, w - 2, 38);
  s.addText(p.price, { x: x + w - 2, y: 1.3, w: 2, h: 0.9, fontFace: SERIF, fontSize: 34, color: C.obsidian, align: "right", margin: 0, valign: "top" });
  s.addText(p.line, { x, y: 2.1, w, h: 0.55, fontFace: SERIF, italic: true, fontSize: 15, color: C.mineral, margin: 0, valign: "top" });
  let y = 2.72;
  if (p.note) {
    s.addText(p.note, { x, y, w, h: 0.3, fontFace: SANS, fontSize: 10, color: C.mineral, charSpacing: 0.5, margin: 0 });
    y += 0.32;
  }
  const rowH = p.items.length > 6 ? 0.31 : 0.42;
  ruledList(s, p.items, x, y + 0.1, w, { rowH, size: 11.5 });
  if (id === "reach") body(s, "Programmatic media spend is billed separately.", x, y + 0.2 + p.items.length * rowH + 0.1, w, 0.3, { fontSize: 10 });
  s.addText(p.cta, { x, y: H - 0.95, w: 3, h: 0.3, fontFace: SANS, fontSize: 9, color: C.obsidian, charSpacing: 2.5, margin: 0, hyperlink: { url: "https://matterofplace.com/submit", tooltip: "matterofplace.com/submit" } });
  s.addNotes(`${p.name}, ${p.price}${p.note ? ` (${p.note})` : ""}. ${productNotes[id]} Call to action on the site: ${p.cta}.`);
});

// ---- 10. comparison -------------------------------------------------------------------------
{
  const s = pptx.addSlide();
  s.background = { color: C.ivory };
  chrome(s, S.compare);
  eyebrow(s, "Property exposure", 0.8, 0.95);
  heading(s, "The four products, side by side.", 0.8, 1.3, 10, 38);
  const [f, r, c, five] = ["feature", "reach", "campaign", "five-features"].map(product);
  const cell = (text, o = {}) => ({ text, options: { fontFace: SANS, fontSize: 10.5, color: C.mineral, valign: "top", ...o } });
  const head = (p) => cell(p.name + (p.recommended ? "\nRecommended" : ""), { fontFace: SERIF, fontSize: 18, color: C.obsidian });
  const label = (t) => cell(t.toUpperCase(), { fontSize: 8, charSpacing: 2, color: C.warm });
  const rows = [
    [cell(""), head(f), head(r), head(c), head(five)],
    [label("Price"), ...[f, r, c, five].map((p) => cell(p.price, { fontFace: SERIF, fontSize: 20, color: C.obsidian }))],
    [label("Purpose"), ...[f, r, c, five].map((p) => cell(p.line))],
    [label("Builds on"), cell("A permanent editorial page"), cell(r.items[0]), cell(c.items[0]), cell("Five Feature credits")],
    [label("Adds"), cell("Narrative, image sequencing, social carousel, attribution, inquiry routing"), cell("Stories, newsletter, priority scheduling, campaign planning"),
      cell("Expanded story, short-form video, standalone email, 10 to 14 day window"), cell("Submit properties individually; distribution upgrades per property")],
    [label("Paid media"), cell("Not part of The Feature"), cell("Optional, billed separately"), cell(c.note + ", billed separately"), cell("Per property, billed separately")],
    [label("Per property"), cell(f.price), cell(r.price), cell(c.price), cell(five.note)],
  ];
  s.addTable(rows, {
    x: 0.8, y: 2.3, w: W - 1.6, colW: [1.5, 2.7, 2.7, 2.7, 2.133],
    border: { type: "solid", pt: 0.75, color: C.sandstone }, fill: { color: C.ivory }, margin: [0.08, 0.12, 0.08, 0.0],
    rowH: [0.62, 0.5, 0.62, 0.45, 0.78, 0.55, 0.42],
  });
  s.addNotes("Every product begins with editorial review. The Reach is recommended for most properties. Programmatic media is always separate from product fees and is never required.");
}

// ---- 11. distribution -----------------------------------------------------------------------
{
  const { slide: s, x, w } = contentSlide(S.distribution, "naples.jpg", "left", C.bone);
  const P = X.programmatic;
  eyebrow(s, "Precision distribution", x, 0.95);
  heading(s, "Beyond the post.", x, 1.3, w, 38);
  body(s, "Selected campaigns can extend beyond our owned audience through targeted programmatic media across premium inventory.", x, 2.2, w - 0.6, 0.7);
  const terms = [["Media from", P.minimum], ["Management", P.managementFee], ["Minimum management fee", P.minimumFee]];
  terms.forEach(([k, v], i) => {
    const y = 3.05 + i * 0.5;
    rule(s, x, y, w);
    s.addText(k.toUpperCase(), { x, y, w: 3, h: 0.5, fontFace: SANS, fontSize: 8.5, color: C.mineral, charSpacing: 2, margin: 0, valign: "middle" });
    s.addText(v, { x: x + 3, y, w: w - 3, h: 0.5, fontFace: SERIF, fontSize: 18, color: C.obsidian, align: "right", margin: 0, valign: "middle" });
  });
  rule(s, x, 4.55, w);
  eyebrow(s, "Formats", x, 4.85);
  body(s, P.formats.join("  ·  "), x, 5.15, w, 0.35, { color: C.obsidian });
  body(s, "Channel selection varies by campaign. Media budgets are separate from editorial product fees.", x, 5.65, w, 0.5, { fontSize: 11 });
  s.addNotes(
    "Not every campaign uses every channel. Distribution is chosen by property, location, audience, campaign objective, budget and available creative. " +
      `Programmatic media begins from ${P.minimum}, with a management fee of ${P.managementFee} and a ${P.minimumFee} minimum management fee. We never promise views, leads or sales.`,
  );
}

// ---- 12. what we do not do ------------------------------------------------------------------
{
  const { slide: s, x, w } = contentSlide(S.not, "gallery/desert-colonnade.jpg", "right", C.ivory);
  eyebrow(s, "What we do not do", x, 0.95);
  heading(s, "Clear from the start.", x, 1.3, w, 38);
  ruledList(s, ["No guaranteed buyers, leads or sales.", "No new developments.", "No markets outside California, New York and Florida.", "No acceptance for payment alone."], x, 2.5, w, { rowH: 0.62, size: 19, face: SERIF });
  body(s, "We provide editorial exposure and media distribution, not transaction guarantees.", x, 5.3, w, 0.5);
  s.addNotes("Be direct about this with every partner. Matter of Place is not a brokerage, does not sell leads and does not guarantee a transaction. It covers existing residential property in three states only.");
}

// ---- 13. FAQ --------------------------------------------------------------------------------
{
  const s = pptx.addSlide();
  s.background = { color: C.bone };
  chrome(s, S.faq);
  eyebrow(s, "Questions", 0.8, 0.95);
  heading(s, "What partners ask first.", 0.8, 1.3, 10, 38);
  const colW = (W - 1.6 - 0.6) / 2;
  X.exposureFaq.forEach((f, i) => {
    const col = i < 4 ? 0 : 1, row = i < 4 ? i : i - 4;
    const x = 0.8 + col * (colW + 0.6), y = 2.3 + row * 1.12;
    rule(s, x, y, colW);
    s.addText(f.q, { x, y: y + 0.08, w: colW, h: 0.5, fontFace: SERIF, fontSize: 15, color: C.obsidian, margin: 0, valign: "top" });
    s.addText(f.a, { x, y: y + (f.q.length > 55 ? 0.66 : 0.44), w: colW, h: 0.45, fontFace: SANS, fontSize: 10.5, color: C.mineral, margin: 0, valign: "top", lineSpacingMultiple: 1.2 });
  });
  s.addNotes(X.exposureFaq.map((f) => `${f.q} ${f.a}`).join(" "));
}

// ---- 14. submit / contact -------------------------------------------------------------------
{
  const s = pptx.addSlide();
  s.background = { color: C.obsidian };
  s.addImage({ path: A + "mill-valley.jpg", x: 0, y: 0, w: 6.2, h: H, sizing: { type: "cover", w: 6.2, h: H } });
  const x = 7.0, w = W - x - 0.8;
  chrome(s, S.submit, { dark: true, left: x });
  s.addText("HOW TO SUBMIT", { x, y: 0.95, w, h: 0.3, fontFace: SANS, fontSize: 9, color: C.sandstone, charSpacing: 3, margin: 0 });
  s.addText("Send us the property and its story.", { x, y: 1.3, w, h: 1.4, fontFace: SERIF, fontSize: 34, color: C.bone, margin: 0, valign: "top" });
  s.addText("matterofplace.com/submit", { x, y: 3.0, w, h: 0.6, fontFace: SERIF, fontSize: 28, color: C.bone, margin: 0, hyperlink: { url: "https://matterofplace.com/submit", tooltip: "Submit a property" } });
  s.addShape(pptx.ShapeType.line, { x, y: 3.65, w, h: 0, line: { color: C.sandstone, width: 0.75 } });
  s.addText("We review every submission and reply.", { x, y: 3.9, w, h: 0.35, fontFace: SANS, fontSize: 13, color: C.sandstone, margin: 0 });
  s.addText("California, New York and Florida. Existing residential property.", { x, y: 4.3, w, h: 0.35, fontFace: SANS, fontSize: 13, color: C.sandstone, margin: 0 });
  emblem(s, x, 5.35, 0.42, C.bone);
  wordmark(s, x + 0.55, 5.4, 4, 11, C.bone);
  s.addText("A PRODUCT OF OMNIKOM", { x: x + 0.55, y: 5.72, w: 4, h: 0.25, fontFace: SANS, fontSize: 7.5, color: C.warm, charSpacing: 2.5, margin: 0 });
  s.addNotes("Close by pointing partners to matterofplace.com/submit. We review every submission and reply. Matter of Place is a product of Omnikom.");
}

const out = join(here, "matter-of-place-for-partners.pptx");
await pptx.writeFile({ fileName: out });
console.log(out);
