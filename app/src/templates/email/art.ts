// The pictures of the emails, served from the site's own origin (`public/email/`, cross-origin since PR 407) at the
// size each is shown. Every file is drawn at two or three times that size for phone screens and every one stands on
// the colour of the paper around it, so no edge shows and a client that darkens the page never darkens the picture.
//   door-night.gif    Threshold's opening: the emblem becomes the film's door and opens onto light (600 x 440, plays
//                     once, frame 1 is the logo); rendered from the film's own 3D hall by launch/email-doors.
//   door-day.gif      Afternoon's opening: the same door in a Bone wall in the afternoon (1200 x 600 shown at 600 x
//                     300, plays once, frame 1 is the logo); drawn by launch/email-doors/afternoon-door.html.
//   door-day-dark.png The same door at night, for Apple Mail's dark mode.
//   wordmark-*.png    The colophon's wordmark on Bone and on Obsidian (scripts/email-art.mjs).
//   lockup-emblem.png The light house's door: the emblem at the size of a line (scripts/email-art.mjs).
//   film-*.jpg        Stills of the film's own houses: the welcome's picture when the latest piece has none, and the
//                     three markets.

export interface Art {
  path: string;
  width: number;
  height: number;
}

export const ART = {
  doorNight: { path: "/email/door-night.gif", width: 600, height: 440 },
  doorDay: { path: "/email/door-day.gif", width: 600, height: 300 },
  doorDayDark: { path: "/email/door-day-dark.png", width: 600, height: 300 },
  wordmark: { path: "/email/wordmark-obsidian.png", width: 180, height: 12 },
  wordmarkDark: { path: "/email/wordmark-bone.png", width: 180, height: 12 },
  emblem: { path: "/email/lockup-emblem.png", width: 23, height: 28 },
  house: { path: "/email/film-house.jpg", width: 520, height: 347 },
  california: { path: "/email/film-california.jpg", width: 600, height: 300 },
  newYork: { path: "/email/film-new-york.jpg", width: 600, height: 300 },
  florida: { path: "/email/film-florida.jpg", width: 600, height: 300 },
} as const satisfies Record<string, Art>;
