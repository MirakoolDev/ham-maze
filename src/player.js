// First-person controller: walk / sprint / crouch / jump, wall sliding, head bob, sprint FOV kick.
// Unity's PlayerController used speed 9; here 9 is the sprint speed and walking is a little slower.
import * as THREE from 'three';

export const RADIUS = 0.4;
const WALK = 5.6, SPRINT = 9, CROUCH = 2.6;
const GRAVITY = 22, JUMP_V = Math.sqrt(2 * GRAVITY * 1.1);
const EYE = 1.6, EYE_CROUCH = 1.0;

export class Player {
  constructor(camera, world) {
    this.camera = camera; this.world = world;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.spawn = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.eye = EYE; this.grounded = true; this.bob = 0;
    this.sensitivity = 1; this.baseFov = 78; this.walked = 0;
  }

  reset(spawn, yaw = 0) {
    this.spawn.copy(spawn); this.pos.copy(spawn); this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0; this.eye = EYE; this.walked = 0;
    this.apply(0);
  }

  distFromSpawn() { return Math.hypot(this.pos.x - this.spawn.x, this.pos.z - this.spawn.z); }

  update(dt, inp) {
    const k = 0.0022 * this.sensitivity;
    this.yaw -= inp.look.dx * k;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch - inp.look.dy * k));

    const crouching = inp.crouch;
    const sprinting = inp.sprint && inp.axis.y > 0 && !crouching;
    this.sprinting = sprinting;
    const speed = (crouching ? CROUCH : sprinting ? SPRINT : WALK) * (inp.speedScale ?? 1);
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * inp.axis.y + cy * inp.axis.x, wz = -cy * inp.axis.y - sy * inp.axis.x;
    const len = Math.hypot(wx, wz);
    if (len > 1) { wx /= len; wz /= len; }

    const t = 1 - Math.exp(-(this.grounded ? 14 : 2.5) * dt);
    this.vel.x += (wx * speed - this.vel.x) * t;
    this.vel.z += (wz * speed - this.vel.z) * t;
    if (this.grounded && inp.pressed.has('Space')) { this.vel.y = JUMP_V; this.grounded = false; }
    this.vel.y -= GRAVITY * dt;

    const before = this.pos.clone();
    const steps = Math.max(1, Math.ceil(Math.hypot(this.vel.x, this.vel.z) * dt / 0.15));
    for (let i = 0; i < steps; i++) {
      this.pos.x += this.vel.x * dt / steps; this.pos.z += this.vel.z * dt / steps;
      this.world.collide(this.pos, RADIUS);
    }
    // keep velocity consistent with where the walls let us go (no sticky sliding)
    if (dt > 0) { this.vel.x = (this.pos.x - before.x) / dt; this.vel.z = (this.pos.z - before.z) / dt; }
    this.walked += Math.hypot(this.pos.x - before.x, this.pos.z - before.z);

    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.grounded = true; }

    this.eye += ((crouching ? EYE_CROUCH : EYE) - this.eye) * (1 - Math.exp(-12 * dt));
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded) this.bob += hs * dt * 1.7;
    this.sprintFov = (this.sprintFov || 0) + ((sprinting && hs > 6 ? 7 : 0) - (this.sprintFov || 0)) * (1 - Math.exp(-6 * dt));
    this.apply(hs);
  }

  apply(hs) {
    const amp = this.grounded ? Math.min(hs / WALK, 1.6) : 0;
    const c = this.camera;
    c.position.set(this.pos.x, this.pos.y + this.eye + Math.sin(this.bob * 2) * 0.045 * amp, this.pos.z);
    c.rotation.set(this.pitch, this.yaw, Math.sin(this.bob) * 0.004 * amp);
    const fov = this.baseFov + (this.sprintFov || 0);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }
}
