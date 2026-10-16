// Role toolkits (ruling H115, review of 2026-10-16): the runner puts a piece's photographs in the run's work folder, so
// a render finds them beside its spec (`localSpec` in scripts/lib/shoot.mjs). A colleague cannot copy a photograph
// itself: its Write tool writes text and `cp` is refused. Only on a run a person or an operator key started, only from
// the places its toolkit names, only the pieces its waking line names by their folder's whole name.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { PHOTO_MAX_BYTES, inside } from "../lib/confine.mjs";

/** The most photographs placed for one piece (a listing's set is 15 to 30). */
const PLACE_MAX_PHOTOS = 40;
/** The photographs a render takes (`IMAGE_TYPES` in shoot.mjs). */
const PHOTO_TYPES = new Set([".jpg", ".jpeg", ".png", ".webp"]);
/** A shorter folder name is a word, not a piece (`Posts`, `draft`). */
const NAME_MIN = 6;

interface PieceSource {
  /** The studio: each piece is a folder at its top. */
  studio: string | null;
  /** The Drive Social Media folder: each piece is a folder one level down (`Carousels/<name>`). */
  driveSocial: string | null;
}

interface Placed {
  /** The folder under the work folder: the piece's own folder name. */
  piece: string;
  photos: number;
  /** Photographs left out: over 25 MB, a link, or past the count. */
  skipped: number;
}

/** The real folders right under `dir`: no link or junction, nothing hidden. */
function folders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name);
}

/** The pieces `line` names: each source folder whose whole name it holds, in any case. */
function namedPieces(
  line: string,
  source: PieceSource,
): { name: string; dir: string; under: string }[] {
  const said = line.toLowerCase();
  const named = (name: string) => name.length >= NAME_MIN && said.includes(name.toLowerCase());
  const studio = source.studio;
  const drive = source.driveSocial;
  return [
    ...(studio === null
      ? []
      : folders(studio)
          .filter(named)
          .map((name) => ({ name, dir: join(studio, name), under: "" }))),
    ...(drive === null
      ? []
      : folders(drive).flatMap((group) =>
          folders(join(drive, group))
            .filter(named)
            .map((name) => ({ name, dir: join(drive, group, name), under: group })),
        )),
  ];
}

/** The photographs inside `dir`, three levels at most, never through a link. */
function photosIn(dir: string, depth = 0): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && depth < 3)
      return photosIn(path, depth + 1);
    return entry.isFile() && PHOTO_TYPES.has(extname(entry.name).toLowerCase()) ? [path] : [];
  });
}

/**
 * Copies the photographs of each piece `line` names into `work/<piece>/`, keeping their folders (a Drive piece under
 * its group, `Carousels/...`). Each must stay inside its piece once links resolve and be at most 25 MB; a link already
 * standing where a copy goes is removed first, so a copy cannot be led out of the work folder.
 */
export function placePieces(line: string, source: PieceSource, work: string): Placed[] {
  const placed = new Map<string, Placed>();
  for (const piece of namedPieces(line, source)) {
    const dest = join(work, piece.name);
    const entry = placed.get(piece.name) ?? { piece: piece.name, photos: 0, skipped: 0 };
    placed.set(piece.name, entry);
    for (const photo of photosIn(piece.dir)) {
      const size = lstatSync(photo).size;
      if (!inside(piece.dir, photo) || size > PHOTO_MAX_BYTES || entry.photos >= PLACE_MAX_PHOTOS) {
        entry.skipped += 1;
        continue;
      }
      const target = join(dest, piece.under, relative(piece.dir, photo));
      clearLinks(work, target);
      mkdirSync(dirname(target), { recursive: true });
      if (!inside(work, target))
        throw new Error(`placing ${piece.name}: ${target} leads out of the folder`);
      copyFileSync(photo, target);
      entry.photos += 1;
    }
  }
  return [...placed.values()];
}

/** Removes any link or junction on the way from `work` to `target` (a run may have left one; Windows makes them). */
function clearLinks(work: string, target: string): void {
  let path = work;
  for (const part of relative(work, target).split(/[\\/]/)) {
    path = join(path, part);
    if (!existsSync(path) && !isLink(path)) return;
    if (isLink(path)) rmSync(path, { recursive: true, force: true });
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** What the run is told about the photographs placed for it. */
export function placedLine(placed: readonly Placed[]): string {
  if (placed.length === 0) return "";
  const each = placed.map(
    (entry) =>
      `${String(entry.photos)} ${entry.photos === 1 ? "photograph" : "photographs"} of ${entry.piece} in \`./${entry.piece}/\`${entry.skipped > 0 ? ` (${String(entry.skipped)} left out: a link, over 25 MB or past ${String(PLACE_MAX_PHOTOS)})` : ""}`,
  );
  return `The runner placed ${each.join("; ")}. A render's spec goes in that folder and names its photographs relative to it.`;
}
