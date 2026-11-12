// Port of Unity's MazeGenerator.cs: recursive backtracker on a width x depth grid, seeded by today's date.
// Cell walls use Unity's names: L (-x), R (+x), B (-z), F (+z), in Unity's left-handed coordinates.
import { DotNetRandom } from './rng.js';

/** Same formula as the C#: Year*10000 + Month*100 + Day, on the UTC date so everyone shares one maze (and the contract's day). */
export function dailySeed(d = new Date()) {
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

export function generateMaze(width, depth, seed, loops = 0) {
  const rng = new DotNetRandom(seed);
  const cells = [];
  for (let x = 0; x < width; x++) {
    for (let z = 0; z < depth; z++) cells.push({ x, z, visited: false, L: true, R: true, F: true, B: true });
  }
  const cell = (x, z) => cells[x * depth + z];

  // Same neighbour order as GetUnvisitedCells: x+1, x-1, z+1, z-1.
  const unvisited = (c) => {
    const out = [];
    if (c.x + 1 < width && !cell(c.x + 1, c.z).visited) out.push(cell(c.x + 1, c.z));
    if (c.x - 1 >= 0 && !cell(c.x - 1, c.z).visited) out.push(cell(c.x - 1, c.z));
    if (c.z + 1 < depth && !cell(c.x, c.z + 1).visited) out.push(cell(c.x, c.z + 1));
    if (c.z - 1 >= 0 && !cell(c.x, c.z - 1).visited) out.push(cell(c.x, c.z - 1));
    return out;
  };

  const clearWalls = (prev, cur) => {
    if (!prev) return;
    if (prev.x < cur.x) { prev.R = false; cur.L = false; }
    else if (prev.x > cur.x) { prev.L = false; cur.R = false; }
    else if (prev.z < cur.z) { prev.F = false; cur.B = false; }
    else if (prev.z > cur.z) { prev.B = false; cur.F = false; }
  };

  const visit = (prev, cur) => {
    cur.visited = true;
    clearWalls(prev, cur);
    let next;
    do {
      const u = unvisited(cur);
      next = u.length ? u[rng.next(u.length)] : null;
      if (next) visit(cur, next);
    } while (next);
  };
  visit(null, cell(0, 0));

  // Loops (admin setting): knock out extra interior walls so there is more than one route. Uses its own
  // generator so a maze with 0 loops is identical to the Unity original.
  if (loops > 0) {
    const lr = new DotNetRandom(seed ^ 0x5eed);
    for (let i = 0, tries = 0; i < loops && tries < loops * 20; tries++) {
      const x = lr.next(width - 1), z = lr.next(depth - 1), c = cell(x, z);
      if (lr.next(2) === 0) { if (c.R) { c.R = false; cell(x + 1, z).L = false; i++; } }
      else if (c.F) { c.F = false; cell(x, z + 1).B = false; i++; }
    }
  }

  return { width, depth, seed, cells, cell, goal: { x: Math.floor(width / 2), z: Math.floor(depth / 2) } };
}
