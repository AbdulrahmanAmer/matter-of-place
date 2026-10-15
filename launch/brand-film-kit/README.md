# Brand Film Kit

A copy of everything on the Brand Film Kit page (version of 15 October 2026), plus the three skills that use it.

## What is in it

| Folder | What it holds |
|---|---|
| `film/` | The film kit, 12 files. `src/film.js` is a two-shot placeholder film; the rest build it, take stills, render the score, export frames, encode the MP4 and test the player page. |
| `vo/` | The voice-over kit, 6 files. `vo.py` is the toolkit; `1_check.py` to `5_verify.py` are the five steps: check, clean, mix, put on the film, verify. |
| `reference/product-launch/` | The full source of the Matter of Place "Product Launch" film, 17 files, with the record of its voice-over. Start with its `README.md`. |
| `skills/` | The three skills as written: `brand-film` (making a film), `brand-film-vo-script` (writing the voice-over), `brand-film-vo-mix` (cleaning and mixing the voice). |

The finished films and audio files are not in here; they are the files delivered in the conversation.

## Making Product Launch again, exactly

`reference/product-launch/README.md` gives the commands that rebuild the film and render it the way it was rendered, and `voice-over.md` beside it gives the exact settings and steps for the voice-over. Both were checked against the delivered files: the voice-over comes out byte for byte the same, and the film's frames do too, apart from a few frames in the opening door shot that differ by one shade in a few pixels.

## How it is used

The skills fetch their code from the kit page in your Claude account, not from this zip:
https://claude.ai/artifact/D89aZHamsfya4TdTb5RLrx

This zip is a copy to keep. If the page is ever lost, attach this zip to a conversation and ask Claude to use it in place of the page, or publish its files again as a new page and update the address in the skills.

## What it needs to run

- Node.js with Playwright and its Chromium, and three.js r128 from npm (`npm i three@0.128.0`).
- ffmpeg.
- Python 3 with numpy, scipy, matplotlib, fonttools and brotli.
- For the voice-over word check: sherpa-onnx and two speech models, which the voice skill downloads.

The skills give the exact commands, in the order they are run.
