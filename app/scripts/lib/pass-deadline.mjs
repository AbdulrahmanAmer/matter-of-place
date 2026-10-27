// The studio pass's deadline (W8 item 1, round 7). The pass's watchdog is a timer, and a render runs its children back
// to back in spawnSync with no turn of the event loop between them (up to about 115 min in one reel), so the timer alone
// could act long after the pass's limit. Each child's limit is therefore cut to what is left of the pass, and no child
// starts once the pass is out of time: the pass ends by its limit, whatever chain of children it is in.

let deadline = Number.POSITIVE_INFINITY;

/**
 * Sets the moment the running studio pass must end by (`studioPass`); Infinity when no pass is running.
 * @param {number} at epoch milliseconds
 */
export function setPassDeadline(at) {
  deadline = at;
}

/**
 * The limit one child may run under: its own, or what is left of the pass when that is less.
 * @param {number} limitMs the child's own limit
 * @param {number} [now]
 * @returns {number}
 */
export function childLimit(limitMs, now = Date.now()) {
  const left = deadline - now;
  if (left <= 0) throw new Error("the studio pass reached its limit; no further step was started");
  return Math.min(limitMs, left);
}
