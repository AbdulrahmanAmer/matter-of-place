# The Matter of Place voice

The brand's narrator. It is a copied voice: every line is generated in the voice of one short reference clip, so the
same narrator speaks in every film. Chosen by the operator on 2 October 2026 (the "liked voice", run v3 of the
qwen-voiceover skill); it is the voice of the Product Launch film.

| File | What it is |
|---|---|
| `matter-of-place-voice.wav` | The reference clip, 1.57 s, 24 kHz. Its exact words: **"It's a matter of place."** |
| `product-launch/matter-of-place-VO_MASTER.wav` | The Product Launch voice-over, polished (48 kHz, 24-bit, starts at 0:00) |
| `product-launch/lines/` | Each line of that voice-over as generated (the takes that were kept) |
| `product-launch/script.json` | Its lines with their cue and slot in seconds |

## Making new lines in this voice

With the `qwen-voiceover` skill on the laptop (ComfyUI's Python, the skill's scripts), from a project folder that
holds a `script.json` like the one above:

```bash
PY="$HOME/Documents/ComfyUI/.venv/Scripts/python.exe"; S="$HOME/.claude/skills/qwen-voiceover/scripts"
"$PY" "$S/make_voiceover.py" --dir <project folder> --clone <repo>/launch/voice/matter-of-place-voice.wav \
  --clone-text "It's a matter of place." --takes 3 --beat 0.4
"$PY" "$S/polish.py" <project folder>/voiceover.wav --out <project folder>/<name>_MASTER.wav
```

The clone text must be the clip's exact words; a copied voice takes its style from that sentence, so keep it. Then
mix it on a film with the brand-film-vo-mix skill (`.claude/skills/brand-film-vo-mix`). House rules hold: no music
beyond the code-made score (S36), calm, brief lines, no em dashes, no hyperbole.
