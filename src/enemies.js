// Sentry drones: patrol the corridors, notice you by sight or gunfire, hunt along the maze graph, fire slow bolts.
// Spawns are seeded from the daily seed, so everyone faces the same placement on the same day.
import * as THREE from 'three';
import { DotNetRandom } from './rng.js';
import { cellCenter } from './world.js';
import { buildDrone } from './dronemodel.js';

import { CFG } from './config.js';
const HOVER = 2.3, RADIUS = 0.6;
const SPEED_PATROL = 2.4, SPEED_HUNT = 4.6;
const SIGHT = 42, FOV_COS = Math.cos((75 * Math.PI) / 180), REACT = 0.5;
const BOLT_SPEED = 26, RANGE = 30;
const REST_Y = 0.4; // wreck height: the lower shell (0.37 below centre) just touches the floor

const shared = {
  bolt: new THREE.SphereGeometry(0.11, 12, 8),
  boltMat: new THREE.MeshBasicMaterial({ color: 0xff7a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
};

export function createEnemies(scene, world, maze, effects, audio, { count = 8 } = {}) {
  const drones = [], bolts = [];
  const api = { drones, kills: 0, total: count, onPlayerHit: null, onKill: null };

  function spawn() {
    for (const d of drones) scene.remove(d.group);
    for (const b of bolts) scene.remove(b.mesh);
    drones.length = 0; bolts.length = 0; api.kills = 0;
    const rng = new DotNetRandom(maze.seed + 7919);
    // candidate cells: at least 5 steps from the start, not the goal cell itself
    const cand = [];
    for (let x = 0; x < maze.width; x++) for (let z = 0; z < maze.depth; z++) {
      if (x === maze.goal.x && z === maze.goal.z) continue;
      if (world.path({ x: 0, z: 0 }, { x, z }).length >= 5) cand.push({ x, z });
    }
    for (let i = 0; i < count && cand.length; i++) {
      const c = cand.splice(rng.next(cand.length), 1)[0];
      const model = buildDrone(), group = model.group;
      const p = cellCenter(c.x, c.z); p.y = HOVER;
      group.position.copy(p); scene.add(group);
      drones.push({
        group, model, pos: p, vel: new THREE.Vector3(), yaw: rng.next(4) * Math.PI / 2, hp: CFG.sentryHealth, dead: false,
        state: 'patrol', route: [], wait: rng.sample() * 2, repath: 0, seeT: 0, lostT: 0, lastSeen: new THREE.Vector3(),
        cooldown: 1 + rng.sample(), charge: 0, flash: 0, phase: rng.sample() * 6, fall: 0, rng, strafe: rng.sample() < 0.5 ? -1 : 1,
      });
    }
  }

  function routeTo(d, target) { d.route = world.path(world.cellOf(d.pos), world.cellOf(target)).map(([x, z]) => cellCenter(x, z)); }

  function alert(d, where) {
    if (d.dead) return;
    d.lastSeen.copy(where);
    if (d.state !== 'hunt') { d.state = 'hunt'; d.repath = 0; }
    d.lostT = 0;
  }

  api.hearShot = (origin, radius = 34) => {
    for (const d of drones) if (!d.dead && d.pos.distanceTo(origin) < radius) alert(d, origin);
  };

  /** Hitscan vs drones: nearest { t, drone, crit, point } within maxT. */
  api.raycast = (o, dir, maxT) => {
    let best = null;
    const sph = (c, r) => {
      const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
      const b = ox * dir.x + oy * dir.y + oz * dir.z, cc = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - cc;
      if (disc < 0) return Infinity;
      const t = -b - Math.sqrt(disc);
      return t > 0 ? t : Infinity;
    };
    const eyeW = new THREE.Vector3();
    for (const d of drones) {
      if (d.dead) continue;
      const tb = sph(d.pos, RADIUS);
      eyeW.copy(d.model.eyeLocal).applyEuler(d.group.rotation).add(d.pos);
      const te = sph(eyeW, d.model.eyeRadius);
      const t = Math.min(tb, te);
      if (t < maxT && (!best || t < best.t)) best = { t, drone: d, crit: te <= tb + 0.25, point: o.clone().addScaledVector(dir, t) };
    }
    return best;
  };

  api.damage = (d, amount, from) => {
    if (d.dead) return false;
    d.hp -= amount; d.flash = 0.08;
    alert(d, from);
    if (d.hp > 0) return false;
    d.dead = true; api.kills++;
    d.model.kill();
    effects.burst(d.pos, 0xffa040, 70, 9);
    audio.kill(d.pos);
    d.vel.set((d.rng.sample() - 0.5) * 3, 2.5, (d.rng.sample() - 0.5) * 3);
    api.onKill && api.onKill(d);
    return true;
  };

  function fire(d, player, eye) {
    const dist = d.pos.distanceTo(eye);
    const lead = player.vel.clone().setY(0).multiplyScalar((dist / BOLT_SPEED) * 0.55);
    const err = 0.35 + dist * 0.035;
    const target = eye.clone().add(lead).add(new THREE.Vector3((d.rng.sample() - 0.5) * err, (d.rng.sample() - 0.5) * err * 0.6 - 0.15, (d.rng.sample() - 0.5) * err));
    const from = new THREE.Vector3(0, 0, -0.55).applyEuler(d.group.rotation).add(d.pos);
    const vel = target.sub(from).normalize().multiplyScalar(BOLT_SPEED);
    const mesh = new THREE.Mesh(shared.bolt, shared.boltMat);
    mesh.position.copy(from); mesh.scale.set(1, 1, 3.2); mesh.lookAt(from.clone().add(vel));
    scene.add(mesh);
    bolts.push({ mesh, pos: from, vel, life: 3, origin: d.pos.clone() });
    audio.enemyShot(d.pos);
  }

  const tmp = new THREE.Vector3();
  api.update = (dt, player, eye, active) => {
    for (const d of drones) {
      const g = d.group;
      if (d.dead) { // wreck falls and stays
        if (!d.landed) {
          d.vel.y -= 18 * dt; d.pos.addScaledVector(d.vel, dt); g.rotation.x += dt * 3; g.rotation.z += dt * 2;
          if (d.pos.y <= REST_Y) {
            d.pos.y = REST_Y; d.vel.set(0, 0, 0); d.landed = true;
            // settle onto its flat underside: wrap the tumble to the nearest upright angle, keep a slight lean
            const wrap = (a) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
            g.rotation.x = wrap(g.rotation.x); g.rotation.z = wrap(g.rotation.z);
            d.restX = (Math.random() - 0.5) * 0.16; d.restZ = (Math.random() - 0.5) * 0.16;
            effects.sparks(d.pos, new THREE.Vector3(0, 1, 0), 20, 0xffa040, 4);
          }
        } else {
          const k = 1 - Math.exp(-10 * dt);
          g.rotation.x += (d.restX - g.rotation.x) * k; g.rotation.z += (d.restZ - g.rotation.z) * k;
        }
        g.position.copy(d.pos); continue;
      }
      d.phase += dt;
      tmp.copy(eye).sub(d.pos);
      const dist = tmp.length();
      const fwd = new THREE.Vector3(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
      const flat = tmp.clone().setY(0).normalize();
      const sees = active && dist < SIGHT && world.los(d.pos, eye) && (d.state === 'hunt' || fwd.dot(flat) > FOV_COS || dist < 7);
      if (sees) { if (d.state !== 'hunt') audio.alert(d.pos); alert(d, player.pos); d.seeT += dt; } else d.seeT = 0;

      let goal = null, speed = SPEED_PATROL, face = null;
      if (d.state === 'hunt') {
        speed = SPEED_HUNT;
        if (sees) {
          face = eye;
          if (dist > 18) { d.repath -= dt; if (d.repath <= 0) { routeTo(d, player.pos); d.repath = 0.6; } goal = d.route[0]; }
          else { // hold range and strafe across the corridor
            goal = d.pos.clone().add(new THREE.Vector3(-flat.z, 0, flat.x).multiplyScalar(d.strafe * 2));
            if (dist < 7) goal.addScaledVector(flat, -2);
            speed = 1.8;
            if (d.rng.sample() < dt * 0.4) d.strafe *= -1;
          }
          // attack: short charge (eye flares) then a bolt
          d.cooldown -= dt;
          if (d.charge > 0) { d.charge -= dt; if (d.charge <= 0) { fire(d, player, eye); d.cooldown = 1.2 + d.rng.sample(); } }
          else if (d.cooldown <= 0 && d.seeT > REACT && dist < RANGE) { d.charge = 0.45; audio.charge(d.pos); }
        } else {
          d.charge = 0; d.lostT += dt;
          d.repath -= dt; if (d.repath <= 0) { routeTo(d, d.lastSeen); d.repath = 1; }
          goal = d.route[0];
          if (!goal && d.pos.distanceTo(d.lastSeen) < 2.5 || d.lostT > 9) { d.state = 'patrol'; d.route = []; d.wait = 1.5; }
        }
      } else { // patrol: wander to a nearby cell, pause, repeat
        if (!d.route.length) {
          d.wait -= dt;
          if (d.wait <= 0) {
            const here = world.cellOf(d.pos);
            const tx = Math.max(0, Math.min(maze.width - 1, here.x + d.rng.next(7) - 3)), tz = Math.max(0, Math.min(maze.depth - 1, here.z + d.rng.next(7) - 3));
            routeTo(d, cellCenter(tx, tz)); d.wait = 1 + d.rng.sample() * 2.5;
          }
        }
        goal = d.route[0];
      }

      // steer
      let want = new THREE.Vector3();
      if (goal) {
        want.copy(goal).sub(d.pos).setY(0);
        const L = want.length();
        if (L < 0.5 && d.route[0] === goal) d.route.shift();
        if (L > 0.01) want.multiplyScalar(Math.min(speed, L * 3) / L);
      }
      for (const o of drones) { // separation
        if (o === d || o.dead) continue;
        const dx = d.pos.x - o.pos.x, dz = d.pos.z - o.pos.z, dd = Math.hypot(dx, dz);
        if (dd < 2 && dd > 0.001) { want.x += (dx / dd) * (2 - dd) * 2; want.z += (dz / dd) * (2 - dd) * 2; }
      }
      d.vel.lerp(want, 1 - Math.exp(-4 * dt));
      d.pos.x += d.vel.x * dt; d.pos.z += d.vel.z * dt;
      world.collide(d.pos, RADIUS + 0.1);
      d.pos.y = HOVER + Math.sin(d.phase * 1.7) * 0.12;

      const targetYaw = face ? Math.atan2(-(face.x - d.pos.x), -(face.z - d.pos.z)) : d.vel.lengthSq() > 0.05 ? Math.atan2(-d.vel.x, -d.vel.z) : d.yaw;
      let dy = ((targetYaw - d.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      d.yaw += dy * (1 - Math.exp(-(face ? 7 : 3) * dt));
      g.position.copy(d.pos);
      g.rotation.set(face ? -Math.atan2(face.y - d.pos.y, Math.hypot(face.x - d.pos.x, face.z - d.pos.z)) * 0.6 : 0, d.yaw, -d.vel.x * 0.02);
      d.flash = Math.max(0, d.flash - dt);
      const fv = new THREE.Vector3(-Math.sin(d.yaw), 0, -Math.cos(d.yaw));
      d.model.animate(dt, { mode: d.state, charge: d.charge, speed: Math.hypot(d.vel.x, d.vel.z), fwdSpeed: d.vel.x * fv.x + d.vel.z * fv.z, flash: d.flash });
    }

    // bolts
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const step = b.vel.clone().multiplyScalar(dt);
      const n = Math.max(1, Math.ceil(step.length() / 0.3));
      let gone = false;
      for (let s = 0; s < n && !gone; s++) {
        b.pos.addScaledVector(step, 1 / n);
        // player capsule: segment from feet+0.2 to eye
        const py = Math.max(player.pos.y + 0.2, Math.min(eye.y, b.pos.y));
        if (active && Math.hypot(b.pos.x - player.pos.x, b.pos.y - py, b.pos.z - player.pos.z) < 0.5) {
          api.onPlayerHit && api.onPlayerHit(CFG.sentryDamage, b.origin); gone = true;
        } else if (world.solidAt(b.pos)) {
          effects.sparks(b.pos, b.vel.clone().normalize().negate(), 14, 0xff7a3a, 4); gone = true;
        }
      }
      b.life -= dt;
      if (gone || b.life <= 0) { scene.remove(b.mesh); bolts.splice(i, 1); continue; }
      b.mesh.position.copy(b.pos);
    }
  };

  spawn();
  api.reset = spawn;
  return api;
}
