// Points for a finished run. Shared by the game (to show the breakdown) and the referee (which recomputes the
// maze from the day's seed and settings and signs only what it computed itself). No three.js here.
import { generateMaze } from './maze.js';

export const POINTS = {
  time: 6000, // at par; up to 2x for beating par
  route: 2000, // walking exactly the shortest route
  sentry: 400, // per sentry destroyed
  rival: 600, // per rival beaten in a live match (Maze Royale)
};
export const PAR_SPEED = 5.6; // m/s, the walking speed: par is the shortest route at a steady walk
export const MAX_SPEED = 9; // m/s, sprint: nothing can finish faster than this along the shortest route

/** Shortest route in cells from the start corner (0,0) to the monolith, using the maze's walls. */
export function shortestCells(maze) {
  const { width: W, depth: D } = maze, key = (x, z) => x * D + z;
  const prev = new Map([[0, -1]]), q = [[0, 0]];
  const open = (c, dx, dz) => (dx === 1 ? !c.R : dx === -1 ? !c.L : dz === 1 ? !c.F : !c.B);
  while (q.length) {
    const [x, z] = q.shift();
    if (x === maze.goal.x && z === maze.goal.z) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= W || b >= D || prev.has(key(a, b)) || !open(maze.cell(x, z), dx, dz)) continue;
      prev.set(key(a, b), key(x, z)); q.push([a, b]);
    }
  }
  let k = key(maze.goal.x, maze.goal.z), n = 0;
  while (prev.has(k) && prev.get(k) !== -1) { k = prev.get(k); n++; }
  return n;
}

/** Metres from the spawn to the monolith's face along the shortest route (the pillar is 3 m wide). */
export function shortestMetres(maze, cellSize) {
  return Math.max(cellSize, shortestCells(maze) * cellSize - 1.5);
}

/** The day's maze exactly as the game builds it. */
export function dayMaze(seed, cfg) {
  return generateMaze(cfg.mazeSize, cfg.mazeSize, seed, cfg.loops);
}

/**
 * Score a run. Faster, shorter, more sentries and more rivals all add up.
 * @returns {{ time:number, route:number, sentries:number, rivals:number, total:number }}
 */
export function scoreRun({ timeMs, walked, kills = 0, rivals = 0 }, shortest) {
  const t = Math.max(1, timeMs / 1000), par = shortest / PAR_SPEED;
  const time = Math.round(POINTS.time * Math.min(2, par / t));
  const route = Math.round(POINTS.route * Math.min(1, shortest / Math.max(walked, shortest)));
  const sentries = Math.round(kills) * POINTS.sentry;
  const rivalPts = Math.round(rivals) * POINTS.rival;
  return { time, route, sentries, rivals: rivalPts, total: time + route + sentries + rivalPts };
}

/** Why a run is not believable, or null. Used by the referee before it signs. */
export function implausible({ timeMs, walked, kills = 0, rivals = 0 }, shortest, cfg) {
  if (!(timeMs > 0) || !(walked >= 0)) return 'bad numbers';
  if (timeMs > 3 * 3600e3) return 'run too long';
  if (timeMs / 1000 < (shortest / MAX_SPEED) * 0.9) return 'faster than possible';
  if (walked < shortest * 0.85) return 'walked less than the shortest route';
  if (walked > (MAX_SPEED * timeMs) / 1000 + 5) return 'walked further than possible in that time';
  if (kills < 0 || kills > cfg.sentries) return 'more sentries than exist';
  if (rivals < 0 || rivals > 3) return 'too many rivals';
  return null;
}
