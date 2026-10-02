# Matter of Place brand assets

This folder holds every brand asset of Matter of Place in ready-to-use formats. Nothing here is a redesign. It is an export of the identity as the website uses it. If a file is missing or out of date, run the one command at the end of this page and everything is rebuilt.

Every SVG here is built from outlines. Text in the SVG files is drawn as shapes, so the logos look the same on a computer that does not have the typefaces installed. The PNG files have transparent backgrounds unless the name says "on" a colour.

## What the identity is made of

Matter of Place is a selective real-estate publication. The idea is that a property is more than an asset, and that place matters. The line is "Exceptional property. Properly considered."

The identity has four parts.

1. The emblem. Two tall vertical planes that meet at a doorway. The left plane is a darker, solid shape. The right plane is lighter and wider, and it has an opening cut into it like a threshold. It is never a house, a roof, a key or a pin.
2. The wordmark. The words MATTER OF PLACE in capital letters, set in Jost Light with wide letter spacing. The word OF is smaller than the other two. The letter A in MATTER and in PLACE is drawn as an inverted V, with no crossbar. This is a Greek capital lambda.
3. The colours. Six quiet, warm tones. Photography supplies all other colour.
4. The typefaces. Jost and Urbanist for utility, Cormorant Garamond for editorial voice, Epilogue for the footer and overlays.

A note on the lambda. The font Jost has no lambda letter, so the website quietly borrows one from the visitor's system font, which is a heavier Arial letter on most machines. These assets do not copy that accident. The lambda here is the Jost Light letter A with its crossbar removed, at the same weight, height and width as the other letters.

## Folder logo/emblem

The emblem alone, in four versions. All files in this folder show the same two planes, the left one at 90 percent strength and the right one at 40 percent strength.

- emblem-obsidian.svg: the emblem in near-black Obsidian on a transparent background. Use it on light backgrounds such as Warm Ivory, Bone or white paper.
- emblem-bone.svg: the emblem in pale Bone on a transparent background. Use it on dark backgrounds or over dark photographs.
- emblem-on-obsidian.svg: a square tile with a solid Obsidian background and the Bone emblem centred inside, with generous space around it. The same picture as the website's favicon.
- emblem-on-bone.svg: a square tile with a solid Bone background and the Obsidian emblem centred inside.
- PNG versions of all four, in square sizes of 64, 128, 256, 512, 1024 and 2048 pixels. The size is the side of the square. For example emblem-obsidian-512.png is 512 by 512 pixels with a transparent background, and emblem-on-bone-1024.png is 1024 by 1024 pixels with a Bone background.

The emblem here is drawn so the two planes meet with no gap at any size: the lighter plane runs a little under the darker one. The single colour SVGs use a mask to keep the two strengths exact. The website's own emblem (the favicon and the header) still has the two paths abutting, which can show a hairline at large sizes. That is a known follow-up for the site and is not changed here.

Clear space: keep at least half of the emblem's width free on every side. Minimum size: 16 pixels high on screen, 6 millimetres in print. Below 32 pixels prefer the tile versions.

## Folder logo/wordmark

The words alone, cropped tight to the letters, with no extra margin. Add the clear space yourself when you place it.

- wordmark-horizontal-obsidian.svg and wordmark-horizontal-bone.svg: MATTER OF PLACE on one line, in Obsidian for light backgrounds and in Bone for dark backgrounds. The line is about fifteen times as wide as it is tall.
- wordmark-stacked-obsidian.svg and wordmark-stacked-bone.svg: three centred lines, MATTER, then a small OF, then PLACE. Use it where the space is narrow or tall, such as a social profile or a spine.
- PNG versions of all four with a transparent background, at widths of 600, 1200, 2400 and 4800 pixels. The height follows the shape. For example wordmark-horizontal-bone-2400.png is 2400 pixels wide.

Clear space: keep free, on every side, the height of the capital letter M. Minimum size: the horizontal wordmark should be at least 120 pixels wide on screen or 25 millimetres in print. The stacked one at least 80 pixels wide or 18 millimetres.

## Folder logo/lockup

The emblem and the wordmark together, ready placed.

- lockup-horizontal-obsidian.svg and lockup-horizontal-bone.svg: the emblem on the left, the wordmark on the right, centred on the same line. The space between the two is exactly the width of the emblem.
- lockup-stacked-obsidian.svg and lockup-stacked-bone.svg: the emblem above, the three-line wordmark below, centred. The space between them is a little under half of the emblem's width, which is how the website footer places its emblem above the name.
- PNG versions of all four, with transparent backgrounds, at widths of 1200, 2400 and 4800 pixels. For example lockup-stacked-obsidian-2400.png.

The website itself does not show the emblem next to this wordmark. Its header and footer set the emblem above a small Urbanist name. The lockups are therefore built from the site's ratios: the emblem is 2.8 times as tall as the wordmark's main letters, as in the header, and the stacked gap follows the footer.

Clear space: keep free, on every side, the width of the emblem. Minimum width: 160 pixels on screen or 30 millimetres in print.

## Folder icons

Small square pictures for browsers, phones and social profiles.

- favicon.svg: the browser tab icon, a copy of the file the website serves. Bone emblem on an Obsidian square.
- favicon.ico: the same picture in the old icon format, for older browsers. A copy of the file the website serves.
- apple-touch-icon.png: the picture iPhones use when the site is saved to the home screen. A copy of the file the website serves.
- avatar-obsidian-180.png, 192, 400, 512 and 1024: square profile pictures with a solid Obsidian background and the Bone emblem. The number is the side in pixels. Use them for Instagram, X, LinkedIn and app icons.
- avatar-bone-180.png, 192, 400, 512 and 1024: the same with a Bone background and the Obsidian emblem. Use them where a lighter picture suits the page.

The emblem sits well inside the square, so a circular crop, as most social sites apply, does not touch it. Do not add text to an avatar.

## Folder colors

The palette, in four formats and one picture.

- palette.png and palette.svg: one sheet with six tall swatches in a row. Under each swatch are its name, its hex value, its RGB value and its role.
- palette.json: the six colours as data, each with name, hex, rgb and role.
- palette.css: the six colours as CSS custom properties, such as --obsidian and --warm-ivory.
- palette.ase: an Adobe Swatch Exchange file, which Photoshop, Illustrator and InDesign can load as a swatch library. It was written with plain code and read back by a checker in this repository. It has not been opened in an Adobe program yet.

The six colours:

- Obsidian, #11110F, RGB 17 17 15. Text on light grounds, dark grounds, the emblem on light backgrounds.
- Bone, #EEEAE1, RGB 238 234 225. Secondary surfaces, the emblem and wordmark on dark backgrounds.
- Warm Ivory, #F5F2EB, RGB 245 242 235. Page background, the default ground for editorial pages.
- Sandstone, #C9C0B2, RGB 201 192 178. Borders, hairlines and quiet accents.
- Mineral Grey, #575751, RGB 87 87 81. Body copy and secondary text on light grounds.
- Warm Grey, #8B877F, RGB 139 135 127. Metadata and large text only, never body copy.

Photography supplies every other colour. Do not add an accent colour.

## Folder typography

The four typefaces of the website, as the font files themselves, with their licence.

- jost/: Jost, a geometric sans. Role: navigation, facts, prices, labels and the wordmark. Weights used: 300 Light, 400 Regular, 500 Medium, 600 SemiBold.
- urbanist/: Urbanist, a geometric sans. Role: interface and utility text, small caps labels. Weights used: 300 Light, 500 Medium, 700 Bold.
- cormorant-garamond/: Cormorant Garamond, a serif. Role: titles, editorial copy, pull quotes. Weights used: 400 Regular, 500 Medium.
- epilogue/: Epilogue, a grotesque sans. Role: the footer and overlays. Weights used: 300 Light, 400 Regular.

Each family folder holds a variable TrueType file (name ending in variable.ttf), a variable WOFF2 file for websites (name ending in variable.woff2), and OFL.txt, the SIL Open Font License that allows free use, including commercial use. The repository of Google Fonts ships these four families only as variable fonts, so there are no separate static files per weight. One variable file contains every weight, including the ones listed above. A modern design program lets you pick the weight by name or number.

The WOFF2 files are the same fonts compressed for the web. They are not cut down to the used weights.

- fonts.css: ready-made @font-face rules that point to the four WOFF2 files, so a web page can use the families by name.
- specimen.png and specimen.svg: one long sheet. For each family it shows the name set in the family, its role, the weights used, the alphabet in each weight, and one calm sentence. All text is outlined in the SVG.

## Use and do not use

Use the logos only in Obsidian or Bone. Put Obsidian on light grounds and Bone on dark ones. Keep photography calm behind the logo, or place the logo on a plain area.

Do not use any of these.

- No gradients, no glow, no drop shadow, no outline, no bevel.
- No gold, and no black and gold pairing. No real-estate blue.
- No stretching, squeezing, slanting or rotating the logos. Keep the width and height in proportion.
- No recolouring outside the six palette colours. Do not use a logo colour that is not Obsidian or Bone.
- No rebuilding the wordmark by typing it. Use the files. In particular do not type the letter A where the lambda belongs.
- No house, roof, key or pin drawn next to the emblem.
- No rounded corners on the tiles, except where a platform forces a round crop.

## Rebuild everything

From the repository root, with Chrome installed, run this one command.

    node launch/tools/brand-build.mjs

It rewrites the whole folder from the website's own source files. Running it twice changes nothing. The tool lives in launch/tools, and its code libraries are listed in launch/package.json. To also compare the outlined wordmark with how Chrome draws the website's text, run launch/tools/brand-wordmark-check.mjs.
