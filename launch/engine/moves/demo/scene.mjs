// The door move alone (W7 E3 proof): the open half, then the close half straight after it, nothing else.
import { film } from "/launch/engine/runtime/film.js";
import { CLOSE_S, OPEN_S, doorMove } from "/launch/engine/moves/door.mjs";

const cues = new URLSearchParams(location.search).get("cues") ?? undefined;
const F = film({
  duration: OPEN_S + CLOSE_S,
  fonts: ['400 34px "Jost"'],
  cues,
});
doorMove(F, {
  canvas: document.getElementById("door"),
  open: 0,
  close: OPEN_S,
});
