# fonts.py - subset open-source variable fonts and pack them for embedding:  python3 fonts.py
# Needs: npm i @fontsource-variable/<family> (file names: ls node_modules/@fontsource-variable/<family>/files) and pip install fonttools brotli.
# Embedded fonts make the film render identically everywhere, headless included; the page must not depend on a font host.
import base64, json, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset
SRC = 'node_modules/@fontsource-variable'
UNI = list(range(0x20, 0x7F)) + [0xA0, 0xB7, 0xD7, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2192]   # add any other characters the film sets
FONTS = [  # (key "CSS family|style|weight range", source file, axes to pin or narrow)
    ('Film Serif|normal|200 500', 'newsreader/files/newsreader-latin-opsz-normal.woff2', {'opsz': 72, 'wght': (200, 500)}),
    ('Film Serif|italic|200 500', 'newsreader/files/newsreader-latin-opsz-italic.woff2', {'opsz': 72, 'wght': (200, 500)}),
    ('Film Sans|normal|300 600', 'jost/files/jost-latin-wght-normal.woff2', {'wght': (300, 600)}),
]
out = {}; os.makedirs('fonts', exist_ok=True)
for key, src, axes in FONTS:
    f = instancer.instantiateVariableFont(TTFont(f'{SRC}/{src}'), axes); f.flavor = None; f.save('fonts/tmp.ttf'); f = TTFont('fonts/tmp.ttf')
    o = subset.Options(); o.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'lnum', 'tnum', 'case']; o.flavor = 'woff2'; o.notdef_outline = True
    s = subset.Subsetter(o); s.populate(unicodes=UNI); s.subset(f); f.flavor = 'woff2'; f.save('fonts/tmp.woff2')
    out[key] = base64.b64encode(open('fonts/tmp.woff2', 'rb').read()).decode(); print(key, len(out[key]) // 1024, 'KB')
os.remove('fonts/tmp.ttf'); os.remove('fonts/tmp.woff2'); json.dump(out, open('fonts/fonts.json', 'w'))
