# Study: how the Product Launch film was made, and what a new piece takes from it

W7 E3, ruling H108 (the film is study material, never a template) and H110 (where its rules meet the house rules).
Source: `launch/brand-film-kit/reference/product-launch/` (DIRECTION.md, `src/film/`, `delivered/stills/`).

## What the film is

Thirty seconds, 1920 x 1080, every frame a pure function of time. The emblem's two planes stand as a doorway in a dark
hall; a door of light opens on "Not every home / is accepted.", the camera goes through, and inside one home is chosen,
framed, published and sent out; then the three markets, the four packages and the principle, and the camera goes back
through the door, which closes into the logo. Everything on screen is a model, a page or light. Nothing is photographed.

## The process, in the order it was built

1. **An idea taken from the mark itself.** The gap between the emblem's planes is a doorway, so the film is a walk
   through a door that not every home gets through. The idea came before any shot.
2. **A world built in code, not drawn.** Each scene is geometry in metres (`1_hall.js`: the emblem at 0.2 m a unit,
   13 m tall), lit and seen through a real lens. The first, flat 2D version was rejected for its modest ambition, not
   for its idea (DIRECTION.md); the rebuild added depth, a moving camera and light you can see.
3. **The camera is the editor.** A slow, low approach and an accelerating push through the doorway (`hallCam`), a crane,
   an orbit, tracking shots, a pull straight back for the lockup. Every move eased with named curves (`00_lib.js`:
   `door`, `push`, `io`, `soft`), never linear, never shaken.
4. **Light as matter.** The door's light is geometry: the pool it throws on the floor (the doorway's shape projected
   from the light, many samples for a soft edge), the beam as stacked slices in the air, dust lit only where its ray
   back to the light passes the open door, a polished floor that reflects. No glow sprite carries the picture.
5. **Hidden cuts.** The two passes through the door happen under a full-frame wash of light, so the film changes world
   without a visible cut; real hard cuts fall only on beats of an 80 BPM grid.
6. **Type as part of the room, then as the frame's own.** The door sentence stands in the hall beside the doorway and
   is reflected in the floor; later titles rise through masks. One italic word a title; ink follows the paper; the
   value flips at every cut.
7. **Sound made, never chosen.** A score of noise, filters and envelopes (no music, S36), and a voice that speaks in
   counterpoint, never saying what is on screen.
8. **Checked by eye at every step.** Stills and contact sheets of each shot were reviewed while it was built.

## What every new piece takes (H110)

The craft and the rules of use above, in the house type (Cormorant Garamond, Jost) and the CLAUDE.md palette, at
1080 x 1920 rendered from source for a vertical piece. A property, market or story piece shows that subject's own
photographs; a brand piece is models, type and light, like the film.

## What repeats: the signature moves (`launch/engine/moves/`)

Only these are fixed, so every piece reads as Matter of Place; everything else is designed fresh for its request.

- **The emblem as a door** (`door.mjs`). Open half (3.75 s): the doorway in the dark, the door opening, light pouring
  through, the push into a wash of light. Close half (3.25 s): from the light, the camera pulls straight back while the
  door closes into the emblem's two flat tones (Bone at 90 and 40 percent); MATTER OF PLACE rises from the centre
  outward as its spacing closes, a Sandstone rule grows, MATTEROFPLACE.COM fades in, and the settled lockup travels
  slowly sideways so the screen is never still. Every requested reel ends with the close half; a brand piece may open
  with the open half. Its sound comes with it (`doorCues`).

How it differs from the film, and why: the engine captures with GL off, so the room is projected onto a 2D canvas
rather than rendered by WebGL, with the same geometry, lens and light model. The film's last two seconds hold
perfectly still; the motion gate allows no still run over 1.0 s and the house rule is that quiet is never a static
screen, so the lockup keeps travelling. The film's tagline is not in the lockup: a reel carries only its requested
titles and the lockup's name and address.

Proof: the move alone (`launch/engine/moves/demo/`) passes the motion gate (1080 x 1920, 6.5 to 7 s, coverage over
85 percent, no still run over 1.0 s, -18 LUFS); then inside a requested reel made by the runner.
