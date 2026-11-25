// The crates in the maze: the boxes you walk into, the one you're holding, and what Blink and Decoy do.
// Where they are and what they hold comes from src/crates.js (shared with the referee).
// A crate looks like the sealed Power-Up packs: a frosted glass box over a sliver of the monolith's orange
// glass, with the crate's own colour glowing inside. You hold one at a time; Q (or the Use button) uses it.
import * as THREE from 'three';
import { cellCenter } from './world.js';
import { dayCrates, distancesToGoal, BLINK_CELLS, CRATE_KINDS } from './crates.js';

const COLOR = { blink: '#ff9a5c', decoy: '#cdb0ff' };
const PICK_R = 1.4, FLOAT_Y = 1.25;
const DECOY_SPEED = 4.2, DECOY_LIFE = 10;

export function createCrates(scene, world, maze, effects, audio) {
  const list = dayCrates(maze);
  const dist = distancesToGoal(maze);
  const D = maze.depth, distAt = (x, z) => dist[x * D + z];

  // ---- the boxes ----
  const boxGeo = new THREE.BoxGeometry(0.72, 0.72, 0.72);
  const coreGeo = new THREE.OctahedronGeometry(0.2, 0);
  const sliverGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.18, transmission: 0.85, thickness: 0.3, ior: 1.35, clearcoat: 1, transparent: true, opacity: 0.6 });
  const sliverMat = new THREE.MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff6a1f', emissiveIntensity: 1.4 });
  const crates = list.map((c) => {
    const g = new THREE.Group();
    const p = cellCenter(c.x, c.z);
    g.position.set(p.x, FLOAT_Y, p.z);
    const box = new THREE.Mesh(boxGeo, glass); box.castShadow = true;
    const coreMat = new THREE.MeshStandardMaterial({ color: COLOR[c.kind], emissive: COLOR[c.kind], emissiveIntensity: 2.4 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    const sliver = new THREE.Mesh(sliverGeo, sliverMat); sliver.position.set(0.18, -0.05, 0.18);
    const light = new THREE.PointLight(COLOR[c.kind], 6, 6, 2); light.position.y = 0.1;
    g.add(box, core, sliver, light);
    scene.add(g);
    return { ...c, group: g, core, box, sliver, light, taken: false, phase: c.x * 1.7 + c.z };
  });

  // ---- the decoy: a see-through copy of the runner, glowing at the rim ----
  const decoy = (() => {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: '#1a1622', emissive: COLOR.decoy, emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.55, depthWrite: false });
    const rim = new THREE.MeshBasicMaterial({ color: COLOR.decoy, transparent: true, opacity: 0.35, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const body = new THREE.CapsuleGeometry(0.28, 0.9, 6, 14); body.translate(0, 0.85, 0);
    const head = new THREE.SphereGeometry(0.2, 16, 12); head.translate(0, 1.62, 0);
    for (const geo of [body, head]) {
      g.add(new THREE.Mesh(geo, mat));
      const r = new THREE.Mesh(geo, rim); r.scale.setScalar(1.12); g.add(r);
    }
    g.visible = false; scene.add(g);
    return { group: g, mat, rim, route: [], life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), eye: new THREE.Vector3() };
  })();

  // a taken crate hides its meshes but keeps its light (at 0): the light count never changes, so no shader recompiles
  function show(c, on) { c.taken = !on; c.box.visible = c.core.visible = c.sliver.visible = on; c.light.intensity = on ? 6 : 0; }

  const api = {
    held: null, // 'blink' | 'decoy' | null
    lure: null, // while a decoy walks: { pos, eye, vel } for the sentries to chase
    onChange: null, // (held) => void, for the HUD
  };

  api.reset = () => {
    for (const c of crates) show(c, true);
    api.held = null; api.lure = null; decoy.group.visible = false; decoy.life = 0;
    api.onChange && api.onChange(null);
  };

  // A Blink: up to BLINK_CELLS steps down the distance field toward the monolith, then land in that cell's middle.
  function blink(player) {
    let { x, z } = world.cellOf(player.pos);
    for (let i = 0; i < BLINK_CELLS; i++) {
      const next = world.neighbours(x, z).find(([a, b]) => distAt(a, b) === distAt(x, z) - 1);
      if (!next) break;
      [x, z] = next;
    }
    const from = player.pos.clone(), to = cellCenter(x, z);
    effects.burst(new THREE.Vector3(from.x, 1, from.z), 0xff9a5c, 40, 5);
    player.pos.x = to.x; player.pos.z = to.z;
    player.vel.set(0, player.vel.y, 0);
    // face on along the corridor toward home
    const ahead = world.neighbours(x, z).find(([a, b]) => distAt(a, b) === distAt(x, z) - 1);
    if (ahead) { const p = cellCenter(ahead[0], ahead[1]); player.yaw = Math.atan2(-(p.x - to.x), -(p.z - to.z)); }
    effects.burst(new THREE.Vector3(to.x, 1, to.z), 0xffd2b0, 60, 7);
    audio.blink && audio.blink();
  }

  // A Decoy: walks off toward a cell no closer to home, as far as it can get in its lifetime.
  function sendDecoy(player) {
    const here = world.cellOf(player.pos), d0 = distAt(here.x, here.z);
    let best = null, bestScore = -Infinity;
    for (let x = 0; x < maze.width; x++) for (let z = 0; z < maze.depth; z++) {
      if (distAt(x, z) < d0) continue; // never toward the monolith: it shouldn't point the way
      const steps = Math.abs(x - here.x) + Math.abs(z - here.z);
      if (steps < 3) continue;
      const s = Math.min(steps, 9) - Math.abs(steps - 7) * 0.3 + ((x * 31 + z * 17) % 5) * 0.01;
      if (s > bestScore) { bestScore = s; best = { x, z }; }
    }
    const route = best ? world.path(here, best).map(([x, z]) => cellCenter(x, z)) : [];
    decoy.route = route; decoy.life = DECOY_LIFE;
    decoy.pos.set(player.pos.x, 0, player.pos.z);
    decoy.group.position.copy(decoy.pos); decoy.group.visible = true;
    api.lure = { pos: decoy.pos, eye: decoy.eye, vel: decoy.vel };
    effects.burst(new THREE.Vector3(player.pos.x, 1, player.pos.z), 0xcdb0ff, 40, 4);
    audio.decoy && audio.decoy();
  }

  /** Use the held crate. Returns its kind, or null if nothing was held. */
  api.use = (player) => {
    const k = api.held;
    if (!k) return null;
    api.held = null;
    if (k === 'blink') blink(player); else sendDecoy(player);
    api.onChange && api.onChange(null);
    return k;
  };

  /** Spin the boxes, pick one up when she walks into it, walk the decoy. Returns the kind just picked up, if any. */
  api.update = (dt, t, player, active) => {
    let picked = null;
    for (const c of crates) {
      if (c.taken) continue;
      const g = c.group;
      g.position.y = FLOAT_Y + Math.sin(t * 1.6 + c.phase) * 0.12;
      c.box.rotation.set(0.3, t * 0.6 + c.phase, 0.2);
      c.core.rotation.y = -t * 1.4;
      if (active && !api.held && Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z) < PICK_R) {
        show(c, false); api.held = c.kind; picked = c.kind;
        effects.burst(g.position.clone(), 0xffffff, 30, 4);
        audio.pickup && audio.pickup();
        api.onChange && api.onChange(c.kind);
      }
    }
    if (decoy.life > 0) {
      decoy.life -= dt;
      const goal = decoy.route[0];
      if (goal) {
        const dx = goal.x - decoy.pos.x, dz = goal.z - decoy.pos.z, L = Math.hypot(dx, dz);
        if (L < 0.4) decoy.route.shift();
        else {
          decoy.vel.set((dx / L) * DECOY_SPEED, 0, (dz / L) * DECOY_SPEED);
          decoy.pos.x += decoy.vel.x * dt; decoy.pos.z += decoy.vel.z * dt;
          decoy.group.rotation.y = Math.atan2(-dx, -dz);
        }
      } else decoy.vel.set(0, 0, 0);
      decoy.eye.set(decoy.pos.x, 1.6, decoy.pos.z);
      decoy.group.position.set(decoy.pos.x, Math.abs(Math.sin(t * 9)) * 0.06, decoy.pos.z);
      const fade = Math.min(1, decoy.life / 1.2);
      decoy.mat.opacity = 0.55 * fade; decoy.rim.opacity = (0.3 + 0.1 * Math.sin(t * 6)) * fade;
      if (decoy.life <= 0) { decoy.group.visible = false; api.lure = null; }
    }
    return picked;
  };

  api.name = (k) => CRATE_KINDS[k]?.name || '';
  return api;
}
