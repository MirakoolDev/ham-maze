// Crates: one-use pickups found inside a run (not NFTs). Solo runs have two kinds for now:
//  - Blink: jumps you up to BLINK_CELLS cells closer to the monolith;
//  - Decoy: a copy of you walks off another way, and sentries follow it.
// Where they sit is seeded from the day's maze, so everyone finds the same crates in the same cells. They're
// spread over the whole maze, not along the route, so where a crate sits says nothing about the way home.
// No three.js here: the referee uses this too, to allow for the distance a Blink skips.
import { DotNetRandom } from './rng.js';

export const CRATES_PER_MAZE = 4;
export const BLINK_CELLS = 3;
export const CRATE_KINDS = {
  blink: { name: 'Blink', hint: 'Jumps you up to 3 cells closer to the monolith' },
  decoy: { name: 'Decoy', hint: 'A copy of you walks off another way. Sentries follow it' },
};

/** The day's crates: [{ x, z, kind }], two of each kind, the same for everyone. */
export function dayCrates(maze, count = CRATES_PER_MAZE) {
  const rng = new DotNetRandom(maze.seed + 4241);
  const cand = [];
  for (let x = 0; x < maze.width; x++) for (let z = 0; z < maze.depth; z++) {
    if (x + z < 3) continue; // not right at the start
    if (x === maze.goal.x && z === maze.goal.z) continue;
    cand.push({ x, z });
  }
  const out = [];
  for (let i = 0; i < count && cand.length; i++) {
    const c = cand.splice(rng.next(cand.length), 1)[0];
    // keep them apart: drop candidates within 2 cells of this one
    for (let j = cand.length - 1; j >= 0; j--) if (Math.abs(cand[j].x - c.x) + Math.abs(cand[j].z - c.z) <= 2) cand.splice(j, 1);
    out.push({ x: c.x, z: c.z, kind: i % 2 === 0 ? 'blink' : 'decoy' });
  }
  return out;
}

/** The most route a run can skip with the day's Blinks, in metres (the referee allows for it). */
export function blinkSkipMetres(maze, cellSize) {
  return dayCrates(maze).filter((c) => c.kind === 'blink').length * BLINK_CELLS * cellSize;
}

/** Steps from every cell to the monolith along open corridors: dist[x * depth + z]. */
export function distancesToGoal(maze) {
  const { width: W, depth: D } = maze, key = (x, z) => x * D + z;
  const dist = new Array(W * D).fill(Infinity), q = [[maze.goal.x, maze.goal.z]];
  dist[key(maze.goal.x, maze.goal.z)] = 0;
  const open = (c, dx, dz) => (dx === 1 ? !c.R : dx === -1 ? !c.L : dz === 1 ? !c.F : !c.B);
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = z + dz;
      if (a < 0 || b < 0 || a >= W || b >= D || dist[key(a, b)] !== Infinity || !open(maze.cell(x, z), dx, dz)) continue;
      dist[key(a, b)] = dist[key(x, z)] + 1; q.push([a, b]);
    }
  }
  return dist;
}
