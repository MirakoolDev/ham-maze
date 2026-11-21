// HAM trailer: a scripted cut through the real game (its maze, sentries, monolith and runner), rendered
// frame by frame. ?sheet=1&at=3,7.5,... draws stills at those seconds in a grid; ?record=1 renders every
// frame, encodes H.264 + AAC with WebCodecs and downloads trailer.mp4; no flag plays it back live.
// Maze: seed 20260119 (a straight five-cell run into the monolith, a ten-cell corridor on the top edge).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { generateMaze } from '../../src/maze.js';
import { buildWorld, setCellSize } from '../../src/world.js';
import { createEffects } from '../../src/effects.js';
import { createPost } from '../../src/post.js';
import { buildDrone } from '../../src/dronemodel.js';
import { createRunner } from '../../src/runner.js';
import { installUiAssets, urls } from '../../src/assets.js';
import { createMp4 } from './mp4.js';
import { renderScore } from './score.js';

const q = new URLSearchParams(location.search);
const FPS = 30, W = 1920, H = 1080, VH = 804, BAR = (H - VH) / 2; // 2.39:1 inside 16:9
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const ramp = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (t, a, b) => { const x = ramp(t, a, b); return x * x * (3 - 2 * x); };
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z));
const pitchTo = (a, b) => Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------- the world ----------------
installUiAssets();
setCellSize(7);
const maze = generateMaze(12, 12, 20260119, 0);
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, VH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.12;
const camera = new THREE.PerspectiveCamera(40, W / VH, 0.05, 1200);
let loading = 0;
THREE.DefaultLoadingManager.onStart = () => { loading++; };
THREE.DefaultLoadingManager.onLoad = () => { loading = 0; };
const world = buildWorld(scene, maze);
world.setShadows(2048);
const effects = createEffects(scene);
const post = createPost(renderer, scene, camera, { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera() });
post.resize(W, VH, 1); post.setQuality('high');
post.grade.uniforms.uSat.value = 1.14;

// the two runners: her in the blue glow with the Marker, the Ember Shade with the Blinker
const her = { r: createRunner(scene), pos: V3(0, 0, 0), vel: V3(), yaw: 0, pitch: 0, aim: 0, crouch: 0, air: false, flash: false, on: false };
const shade = { r: createRunner(scene, { look: 'ember' }), pos: V3(0, 0, 0), vel: V3(), yaw: 0, pitch: 0, aim: 0, crouch: 0, air: false, flash: false, on: false };
const ACTORS = [her, shade];
function stepActor(a, dt) {
  a.r.update(dt, { pos: a.pos, vel: a.vel, yaw: a.yaw, pitch: a.pitch, speed: Math.hypot(a.vel.x, a.vel.z), air: a.air, clipLift: true,
    crouch: a.crouch, aim: a.aim, kick: a.flash ? (a.r.act && a.r.act.kick) || 1 : 0, flash: a.flash });
}

// ---------------- sentries, bolts, embers ----------------
const drones = [];
function spawnDrone(pos, yaw) {
  const m = buildDrone(); scene.add(m.group);
  const d = { m, pos: pos.clone(), yaw, mode: 'patrol', charge: 0, dead: false, vy: 0, tumble: V3(), landed: false, flash: 0 };
  drones.push(d); placeDrone(d); return d;
}
const eyeOf = (d) => d.m.eyeLocal.clone().applyEuler(d.m.group.rotation).add(d.pos);
function placeDrone(d) { d.m.group.position.copy(d.pos); d.m.group.rotation.set(d.tumble.x, d.yaw + d.tumble.y, d.tumble.z); }
function killDrone(d, vy = 1.2) { if (d.dead) return; d.dead = true; d.m.kill(); d.vy = vy; effects.burst(d.pos, 0xffa040, 80, 9); }
function updateDrones(dt) {
  for (const d of drones) {
    if (d.dead) {
      if (!d.landed) {
        d.vy -= 9.8 * dt; d.pos.y += d.vy * dt; d.tumble.x += dt * 2.2; d.tumble.z += dt * 1.4;
        if (d.pos.y <= 0.4) { d.pos.y = 0.4; d.landed = true; effects.sparks(d.pos, V3(0, 1, 0), 26, 0xffa040, 4); }
      }
    } else { d.flash = Math.max(0, d.flash - dt); d.m.animate(dt, { mode: d.mode, charge: d.charge, speed: 0.4, fwdSpeed: 0, flash: d.flash }); }
    placeDrone(d);
  }
}
const boltGeo = new THREE.SphereGeometry(0.11, 12, 8);
const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.9, 0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const emberMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.0, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const bolts = [];
function bolt(from, to, speed, ember = false) {
  const mesh = new THREE.Mesh(boltGeo, ember ? emberMat : boltMat);
  const dir = to.clone().sub(from), len = dir.length(); dir.normalize();
  if (ember) { mesh.scale.set(0.55, 0.55, 5); mesh.lookAt(dir); }
  mesh.position.copy(from); scene.add(mesh);
  bolts.push({ mesh, pos: from.clone(), dir, left: len, speed, ember });
}
function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], step = Math.min(b.left, b.speed * dt);
    b.pos.addScaledVector(b.dir, step); b.left -= step; b.mesh.position.copy(b.pos);
    if (b.ember) b.mesh.quaternion.setFromUnitVectors(V3(0, 0, 1), b.dir);
    if (b.left <= 1e-4) { effects.sparks(b.pos, b.dir.clone().negate(), b.ember ? 22 : 14, b.ember ? 0xff6a2a : 0xff7a3a, 4.5); scene.remove(b.mesh); bolts.splice(i, 1); }
  }
}
// embers: the Shade's motes, and the cloud she breaks into
const EMB = 1400, embPos = new Float32Array(EMB * 3), embCol = new Float32Array(EMB * 3), emb = [];
const embGeo = new THREE.BufferGeometry();
embGeo.setAttribute('position', new THREE.BufferAttribute(embPos, 3)); embGeo.setAttribute('color', new THREE.BufferAttribute(embCol, 3));
const embPts = new THREE.Points(embGeo, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
embPts.frustumCulled = false; scene.add(embPts);
function ember(p, v, life) { if (emb.length >= EMB) emb.shift(); emb.push({ p: p.clone(), v: v.clone(), life, max: life }); }
function updateEmbers(dt) {
  for (let i = emb.length - 1; i >= 0; i--) { const e = emb[i]; e.life -= dt; if (e.life <= 0) { emb.splice(i, 1); continue; } e.v.multiplyScalar(Math.exp(-0.8 * dt)); e.v.y += 0.35 * dt; e.p.addScaledVector(e.v, dt); }
  for (let i = 0; i < EMB; i++) {
    const e = emb[i];
    if (!e) { embPos[i * 3 + 1] = -999; continue; }
    embPos.set([e.p.x, e.p.y, e.p.z], i * 3);
    const k = e.life / e.max, h = Math.min(1, k * 1.6);
    embCol.set([3.2 * h, (0.4 + 0.9 * k) * h, 0.12 * k * h], i * 3);
  }
  embGeo.attributes.position.needsUpdate = true; embGeo.attributes.color.needsUpdate = true;
}
// a few hundred points on the Shade's skin, in world space
function shadeSkin(n) {
  let mesh = null; shade.r.root.traverse((o) => { if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; });
  const out = [], v = V3(), cnt = mesh.geometry.attributes.position.count;
  shade.r.root.updateMatrixWorld(true); mesh.skeleton.update();
  for (let i = 0; i < n; i++) { mesh.getVertexPosition(Math.floor(Math.random() * cnt), v); out.push(v.clone().applyMatrix4(mesh.matrixWorld)); }
  return out;
}
const emberLight = new THREE.PointLight(0xff6a2a, 0, 7, 2); scene.add(emberLight);

// one shot from an actor: flash at the muzzle, a tracer, sparks where it lands
function shoot(a, target, { hit = true, normal = null } = {}) {
  a.flash = true; a._target = target; a._hit = hit; a._normal = normal;
}
function afterShots() {
  for (const a of ACTORS) {
    if (!a.flash || !a.on) continue;
    const m = a.r.muzzle();
    effects.flash(m);
    if (!a._target) continue;
    effects.tracer(m, a._target);
    const n = a._normal || m.clone().sub(a._target).normalize();
    effects.sparks(a._target, n, a._hit ? 18 : 10, a === shade ? 0xff6a2a : 0xff9ad0, 4);
    if (!a._hit && a._normal) effects.hole(a._target, a._normal);
  }
}

// ---------------- the shots ----------------
// t: seconds into the shot (screen time), s: its own time (slower than t in slow motion).
// ev: [s, sound, action]; the score reads the sounds, the picture runs the actions.
const RUN = 5.2, STEP = 0.31;
const steps = (from, to, every = STEP, gain = 1) => { const out = []; for (let s = from; s < to; s += every) out.push([s, 'step', null, gain]); return out; };
const her0 = (p, yaw, o = {}) => ({ who: her, p, yaw, ...o });
const S = {}; // per-shot state
const SHOTS = [
  { name: 'open', dur: 2.6, black: true, texts: [{ t0: 0.3, t1: 2.35, lines: ['EVERY DAY'] }, { t0: 1.05, t1: 2.35, lines: ['', 'A NEW MAZE'] }], ev: [[0.3, 'tick'], [1.05, 'tick']] },
  { name: 'aerial', dur: 4.0, fadeIn: 0.9, exposure: 0.78,
    setup() { S.d1 = spawnDrone(V3(21, 2.3, -56), -Math.PI / 2); S.d2 = spawnDrone(V3(63, 2.3, -21), Math.PI); },
    update(t) {
      const k = ease(t / 4);
      camera.position.copy(V3(4, 24, 6).lerp(V3(20, 15, -14), k)); camera.fov = 46 - 6 * k;
      camera.lookAt(V3(36, 2, -36).lerp(V3(42, 4, -42), k));
      S.d1.pos.x = 21 + t * 1.2; S.d2.pos.z = -21 - t * 1.2;
    } },
  { name: 'runAway', dur: 3.0, actors: [her0(V3(0, 0, 3), 0, { vel: V3(0, 0, -RUN) })], ev: steps(0.12, 3),
    update(t, s) {
      her.pos.set(0, 0, 3 - RUN * s); her.vel.set(0, 0, -RUN); her.yaw = 0;
      camera.position.set(1.15, 0.32, 2.3); camera.fov = 42;
      camera.lookAt(0.25, 1.05, Math.min(her.pos.z - 4, -3));
    } },
  { name: 'track', dur: 1.6, actors: [her0(V3(24, 0, 0.2), -Math.PI / 2, { vel: V3(RUN, 0, 0) })], ev: steps(0.05, 1.6),
    update(t, s) {
      her.pos.set(24 + RUN * s, 0, 0.2); her.vel.set(RUN, 0, 0); her.yaw = -Math.PI / 2;
      camera.position.set(her.pos.x + 0.65, 1.35 + 0.03 * Math.sin(t * 19), 2.35); camera.fov = 38;
      camera.lookAt(her.pos.x + 0.25, 1.25, 0.2);
    } },
  { name: 'peek', dur: 2.2, actors: [her0(V3(29.5, 0, 0.2), -Math.PI / 2, { vel: V3(1.6, 0, 0), crouch: 1 })],
    setup() { S.a = spawnDrone(V3(64, 2.3, -0.6), Math.PI); },
    update(t, s) {
      const u = Math.min(s, 1.4);
      her.pos.set(29.5 + 1.6 * (u - (u * u) / 2.8), 0, 0.2); her.vel.set(1.6 * Math.max(0, 1 - s / 1.4), 0, 0); her.crouch = 1;
      S.a.pos.x = 64 - 0.5 * s;
      const eye = eyeOf(S.a);
      her.yaw = yawTo(her.pos, eye); her.pitch = pitchTo(V3(her.pos.x, 1.1, her.pos.z), eye); her.aim = smooth(s, 1.15, 1.9);
      camera.position.set(her.pos.x - 2.0, 1.05, 1.05); camera.fov = 30;
      camera.lookAt(62, 1.9, -0.4);
    } },
  { name: 'eye', dur: 1.0, ev: [[0.3, 'charge']],
    setup() { S.a = spawnDrone(V3(62.9, 2.3, -0.6), Math.PI); },
    update(t) {
      S.a.yaw = Math.PI - (Math.PI / 2) * smooth(t, 0.08, 0.5); S.a.mode = t > 0.3 ? 'hunt' : 'patrol'; S.a.charge = smooth(t, 0.3, 1.0);
      camera.position.set(60.0, 2.15, -0.25); camera.fov = 28 - 6 * ease(t);
      camera.lookAt(eyeOf(S.a));
    } },
  { name: 'fire1', dur: 1.8,
    actors: [her0(V3(30.62, 0, 0.2), -Math.PI / 2, { crouch: 1, aim: 1 })],
    setup() { S.a = spawnDrone(V3(62.9, 2.3, -0.6), Math.PI / 2); S.a.mode = 'hunt'; },
    ev: [
      [0.15, 'pop', () => { shoot(her, eyeOf(S.a).add(V3(-0.5, 0.1, 0.2))); S.a.flash = 0.08; }],
      [0.47, 'pop', () => shoot(her, V3(S.a.pos.x + 2.5, 2.9, -2.8), { hit: false, normal: V3(0, 0, 1) })],
      [0.55, 'bolt', () => bolt(eyeOf(S.a), V3(33.4, 1.6, 2.8), 45)],
      [0.79, 'pop', () => { shoot(her, eyeOf(S.a).add(V3(-0.5, -0.1, 0))); S.a.flash = 0.08; }],
      [1.0, 'bolt', () => bolt(eyeOf(S.a), V3(32.6, 0.05, -1.4), 45)],
      [1.11, 'pop', () => { shoot(her, eyeOf(S.a).add(V3(-0.5, 0.2, -0.1))); S.a.flash = 0.08; }],
      [1.23, 'spark'], [1.68, 'spark'],
      [1.43, 'pop', () => shoot(her, eyeOf(S.a).add(V3(-0.5, 0, 0)))], [1.45, 'boom', () => killDrone(S.a)],
    ],
    update(t, s) {
      if (!S.a.dead) { S.a.pos.x = 62.9 - 1.6 * s; S.a.pos.z = -0.6 + 0.5 * Math.sin(s * 3); }
      her.pos.set(30.62, 0, 0.2); her.vel.set(0, 0, 0); her.crouch = 1; her.aim = 1;
      const eye = eyeOf(S.a); her.yaw = yawTo(her.pos, eye); her.pitch = pitchTo(V3(her.pos.x, 1.1, her.pos.z), eye);
      camera.position.set(her.pos.x - 1.6, 1.15, 0.95); camera.fov = 15;
      camera.lookAt(V3(her.pos.x + 6, 1.1, 0).lerp(eye, 0.8));
    } },
  { name: 'fall', dur: 1.3, slow: 0.45, ev: [[0.529, 'thud']],
    setup() { S.a = spawnDrone(V3(60.6, 2.3, -0.6), Math.PI / 2); killDrone(S.a, -1); S.a.tumble.set(0.4, 0, 0.3); },
    update(t) { camera.position.set(57.9, 0.55, 1.0); camera.fov = 34; camera.lookAt(V3(60.6, 0.5, -0.6).lerp(S.a.pos, 0.6)); } },
  { name: 'charge', dur: 2.6,
    actors: [her0(V3(30, 0, 0), -Math.PI / 2, { vel: V3(5.0, 0, 0), aim: 1 })],
    setup() { S.b = spawnDrone(V3(53, 2.0, 1.0), Math.PI / 2); S.c = spawnDrone(V3(57.5, 2.5, -1.3), Math.PI / 2); S.b.mode = S.c.mode = 'hunt'; },
    ev: [
      ...steps(0, 2.6, STEP, 0.7),
      [0.2, 'bolt', () => bolt(eyeOf(S.b), V3(30.5 + 5.0 * 0.6, 1.4, 2.9), 45)],
      [0.3, 'pop', () => shoot(her, eyeOf(S.b).add(V3(-0.4, 0.15, 0)))],
      [0.45, 'bolt', () => bolt(eyeOf(S.c), V3(32 + 5.0 * 0.9, 0.05, -1.6), 45)],
      [0.62, 'pop', () => shoot(her, eyeOf(S.b).add(V3(-0.4, -0.1, 0.1)))],
      [0.9, 'bolt', () => bolt(eyeOf(S.b), V3(34 + 5.0 * 1.4, 2.4, -3.45), 45)],
      [0.94, 'pop', () => shoot(her, eyeOf(S.b).add(V3(-0.4, 0, -0.1)))],
      [1.26, 'pop', () => shoot(her, eyeOf(S.b).add(V3(-0.4, 0, 0)))], [1.28, 'boom', () => killDrone(S.b)],
      [1.3, 'bolt', () => bolt(eyeOf(S.c), V3(35 + 5.0 * 1.8, 0.05, 1.7), 45)],
      [1.58, 'pop', () => shoot(her, eyeOf(S.c).add(V3(-0.4, 0.1, 0)))],
      [1.75, 'bolt', () => bolt(eyeOf(S.c), V3(36 + 5.0 * 2.2, 1.0, -3.45), 45)],
      [1.9, 'pop', () => shoot(her, eyeOf(S.c).add(V3(-0.4, -0.1, 0)))],
      [2.22, 'pop', () => shoot(her, eyeOf(S.c).add(V3(-0.4, 0, 0)))], [2.24, 'boom', () => killDrone(S.c)],
    ],
    update(t, s) {
      her.pos.set(30 + 5.0 * s, 0, 0); her.vel.set(5.0, 0, 0); her.aim = 1;
      const tgt = !S.b.dead ? S.b : S.c, eye = eyeOf(tgt);
      her.yaw = yawTo(her.pos, eye); her.pitch = pitchTo(V3(her.pos.x, 1.3, her.pos.z), eye);
      camera.position.set(68 - 0.5 * s, 1.5, -0.3); camera.fov = 17;
      camera.lookAt(V3(her.pos.x, 1.2, her.pos.z).lerp(V3(55, 2.2, 0), 0.22));
    } },
  { name: 'leap', dur: 1.2, slow: 0.667, actors: [her0(V3(0, 0, -7), 0, { vel: V3(0, 0, -RUN) })], ev: [[0.1, 'jump']],
    update(t, s) {
      her.pos.set(0, 0, -7 - RUN * s); her.vel.set(0, 0, -RUN); her.yaw = 0; her.air = s > 0.1 && s < 0.73;
      camera.position.set(0.55, 0.22, -10.4); camera.fov = 50;
      camera.lookAt(0, 1.7, -8);
    } },
  { name: 'reload', dur: 1.3, actors: [her0(V3(0, 0, -20), 0)], ev: [[0.05, 'shake', () => her.r.reload()]],
    update() {
      her.pos.set(0, 0, -20); her.vel.set(0, 0, 0); her.yaw = 0;
      camera.position.set(0.95, 1.42, -21.25); camera.fov = 30; camera.lookAt(0.02, 1.25, -20.05);
    } },
  { name: 'card2', dur: 2.2, black: true, texts: [{ t0: 0.25, t1: 2.0, lines: ['SOMEONE ELSE'] }, { t0: 0.75, t1: 2.0, lines: ['', 'IS LOOKING TOO'] }], ev: [[0.25, 'tick'], [0.75, 'tick']] },
  { name: 'shadeReveal', dur: 2.8, fadeIn: 0.6, exposure: 0.85,
    actors: [{ who: shade, p: V3(74, 0, -77), yaw: Math.PI / 2 }],
    update(t, s) {
      shade.pos.set(74, 0, -77); shade.yaw = Math.PI / 2;
      camera.position.set(40 + 0.8 * t, 1.4, -77.2); camera.fov = 8.5 - 2.6 * ease(t / 2.8);
      camera.lookAt(74, 1.15, -77);
    } },
  { name: 'face', dur: 1.1, exposure: 0.9, actors: [her0(V3(44, 0, -77), -Math.PI / 2)],
    update(t) {
      her.pos.set(44, 0, -77); her.yaw = -Math.PI / 2;
      camera.position.set(44.98 - 0.15 * t, 1.62, -77.1); camera.fov = 26; camera.lookAt(44, 1.58, -77.02);
    } },
  { name: 'raise', dur: 1.1, exposure: 0.9,
    actors: [her0(V3(44, 0, -77), -Math.PI / 2), { who: shade, p: V3(74, 0, -77), yaw: Math.PI / 2 }],
    update(t, s) {
      her.pos.set(44, 0, -77); shade.pos.set(74, 0, -77);
      her.yaw = yawTo(her.pos, shade.pos); her.pitch = 0; her.aim = smooth(s, 0.15, 0.6);
      shade.yaw = yawTo(shade.pos, her.pos); shade.pitch = 0; shade.aim = smooth(s, 0.3, 0.75);
      camera.position.set(42.6, 1.55, -76.25); camera.fov = 13; camera.lookAt(74, 1.25, -77.1);
    } },
  { name: 'shadeFires', dur: 1.0, exposure: 0.9,
    actors: [her0(V3(44.5, 0, -77), -Math.PI / 2, { aim: 1, vel: V3(RUN, 0, 0) }), { who: shade, p: V3(74, 0, -77), yaw: Math.PI / 2, aim: 1 }],
    ev: [0.1, 0.18, 0.26, 0.62, 0.7, 0.78].map((at, i) => [at, 'zap', () => { shade.flash = true; shade._target = null; bolt(shade.r.muzzle(), V3(46 + i * 0.6, 0.4 + (i % 3) * 0.9, -77 + (i % 2 ? 2.75 : -2.75)), 80, true); }]),
    update(t, s) {
      her.pos.set(44.5 + RUN * s, 0, -77); her.vel.set(RUN, 0, 0); her.aim = 1; her.yaw = yawTo(her.pos, shade.pos);
      shade.pos.set(74, 0, -77); shade.aim = 1; shade.yaw = yawTo(shade.pos, her.pos);
      camera.position.set(75.6, 1.6, -77.8); camera.fov = 13; camera.lookAt(46, 1.2, -77);
    } },
  { name: 'herCharge', dur: 1.3, exposure: 0.9,
    actors: [her0(V3(46, 0, -77), -Math.PI / 2, { aim: 1, vel: V3(RUN, 0, 0) })],
    ev: [
      ...steps(0, 1.3, STEP, 0.7),
      ...[0.1, 0.42, 0.74, 1.06].map((at) => [at, 'pop', () => shoot(her, V3(74, 1.3, -77), { hit: false })]),
      ...[0.05, 0.13, 0.21, 0.6, 0.68, 0.76].map((at, i) => [at, i === 2 || i === 5 ? 'spark' : null, () => bolt(V3(her.pos.x + 26, 1.4, -77), V3(her.pos.x + 1.5 + i * 0.3, 0.3 + (i % 3) * 1.1, -77 + (i % 2 ? 2.75 : -2.75)), 90, true)]),
    ],
    update(t, s) {
      her.pos.set(46 + RUN * s, 0, -77); her.vel.set(RUN, 0, 0); her.aim = 1; her.yaw = yawTo(her.pos, V3(74, 0, -77)); her.pitch = 0;
      camera.position.set(her.pos.x + 3.0, 1.35 + 0.04 * Math.sin(t * 23), -77.9); camera.fov = 36;
      camera.lookAt(her.pos.x, 1.25, -77.05);
    } },
  { name: 'airShot', dur: 1.1, slow: 0.4,
    actors: [her0(V3(52.8, 0, -77), -Math.PI / 2, { aim: 1, vel: V3(RUN, 0, 0) })],
    ev: [[0, 'jump'], [0.22, 'pop', () => shoot(her, V3(74, 1.3, -77), { hit: false })]],
    update(t, s) {
      her.pos.set(52.8 + RUN * s, 0, -77); her.vel.set(RUN, 0, 0); her.aim = 1; her.air = true; her.yaw = yawTo(her.pos, V3(74, 0, -77));
      camera.position.set(her.pos.x + 1.7, 1.1, -74.9); camera.fov = 38;
      camera.lookAt(her.pos.x + 0.2, 1.3, -77);
    } },
  { name: 'dissolve', dur: 2.2, exposure: 0.85,
    actors: [{ who: shade, p: V3(74, 0, -77), yaw: Math.PI / 2, aim: 1 }],
    ev: [
      [0.05, 'spark', () => { effects.tracer(V3(62, 1.35, -77), V3(73.8, 1.35, -77)); effects.sparks(V3(73.75, 1.35, -77), V3(-1, 0.2, 0), 40, 0xff9ad0, 5); }],
      [0.3, 'thud'],
      [1.05, 'dissolve', () => { for (const p of shadeSkin(1100)) ember(p, V3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(0.9), 1.0 + Math.random() * 1.2); }],
    ],
    update(t, s) {
      shade.pos.set(74, 0, -77); shade.yaw = Math.PI / 2;
      shade.aim = 1 - smooth(s, 0.08, 0.3); shade.crouch = s > 0.12 ? 1 : 0;
      const flick = s > 0.65 && s < 1.05 && Math.sin(s * (40 + 60 * s)) > 0;
      shade.hidden = flick || s >= 1.05;
      emberLight.position.set(73.6, 1.2, -77); emberLight.intensity = s < 1.05 ? 4 : 18 * Math.exp(-(s - 1.05) * 2.2);
      camera.position.set(71.1, 1.3, -75.9); camera.fov = 32; camera.lookAt(74, 0.95, -77);
    } },
  { name: 'finalRun', dur: 3.0, actors: [her0(V3(74, 0, -42), Math.PI / 2, { vel: V3(-RUN, 0, 0) })], ev: steps(0.05, 3),
    update(t, s) {
      her.pos.set(74 - RUN * s, 0, -42); her.vel.set(-RUN, 0, 0); her.yaw = Math.PI / 2;
      camera.position.set(her.pos.x + 2.9, 0.95, -41.25); camera.fov = 46; camera.lookAt(40, 3.6, -42.3);
    } },
  { name: 'reverse', dur: 2.2, actors: [her0(V3(57.2, 0, -42), Math.PI / 2, { vel: V3(-RUN, 0, 0) })], ev: steps(0.05, 1.9),
    update(t, s) {
      const a = RUN / 0.9, x = s < 1.2 ? 57.2 - RUN * s : 57.2 - RUN * 1.2 - (RUN * Math.min(s - 1.2, 0.9) - (a * Math.min(s - 1.2, 0.9) ** 2) / 2);
      const v = s < 1.2 ? RUN : Math.max(0, RUN - a * (s - 1.2));
      her.pos.set(x, 0, -42); her.vel.set(-v, 0, 0); her.yaw = Math.PI / 2;
      camera.position.set(46.4, 1.15, -42.55); camera.fov = 30; camera.lookAt(her.pos.x, 1.25, -42);
    } },
  { name: 'touch', dur: 2.6, flashOut: [2.15, 2.6], actors: [her0(V3(48.4, 0, -42), Math.PI / 2)],
    ev: [[0.6, 'surge', () => world.celebrate()]],
    update(t, s) {
      const x = 48.4 - 2.4 * smooth(s, 0, 1.2); her.pos.set(x, 0, -42); her.vel.set(s < 1.2 ? -1.6 : 0, 0, 0); her.yaw = Math.PI / 2;
      const k = ease(ramp(t, 0.75, 2.5));
      camera.position.copy(V3(48.6, 1.45, -39.6).lerp(V3(66, 50, -18), k)); camera.fov = 40 + 14 * k;
      camera.lookAt(V3(45, 1.5, -42).lerp(V3(42, 1, -42), k));
    } },
  { name: 'title', dur: 5.6, black: true, title: true, ev: [] },
];
let T0 = 0; for (const sh of SHOTS) { sh.start = T0; T0 += sh.dur; }
const DURATION = T0;
const at = (name) => SHOTS.find((s) => s.name === name).start;

// the score's cues, placed on the cuts
const CUTS = SHOTS.map((s) => s.start);
const surgeT = at('touch') + 0.6;
const CUES = [
  { k: 'drone', t0: 0, t1: at('eye'), f: 55, gain: 0.1 },
  { k: 'beats', t0: at('aerial'), t1: at('eye') - 0.3, every: 1.0, accel: 0.035, min: 0.42, gain: 0.5 },
  ...['runAway', 'track', 'peek', 'fire1', 'fall', 'charge', 'leap', 'reload', 'face', 'raise', 'shadeFires', 'herCharge', 'airShot', 'finalRun', 'reverse'].map((n) => ({ k: 'whoosh', t: at(n), gain: 0.14 })),
  { k: 'riser', t0: at('peek') + 0.2, t1: at('eye') },
  { k: 'braam', t: at('eye'), f: 55, len: 2.8, gain: 0.5 },
  { k: 'pulse', t0: at('fire1'), t1: at('card2') - 0.2, gain: 0.14, bright: 900 },
  { k: 'impact', t: at('card2'), gain: 0.55 },
  { k: 'drone', t0: at('card2'), t1: at('raise'), f: 49, gain: 0.09 },
  { k: 'strings', t0: at('shadeReveal'), t1: at('raise') + 0.4, f: 392, gain: 0.03 },
  { k: 'beats', t0: at('shadeReveal') + 0.2, t1: at('raise') - 0.2, every: 0.8, accel: 0.02, min: 0.45, gain: 0.45 },
  { k: 'riser', t0: at('face'), t1: at('raise') + 0.35, gain: 0.2 },
  { k: 'braam', t: at('shadeFires'), f: 49, len: 2.2, gain: 0.45 },
  { k: 'pulse', t0: at('shadeFires'), t1: at('dissolve'), gain: 0.16, bright: 1500 },
  { k: 'impact', t: at('dissolve'), gain: 0.8 },
  { k: 'drone', t0: at('dissolve'), t1: at('finalRun') + 1.5, f: 55, gain: 0.06, cutoff: 260 },
  { k: 'riser', t0: surgeT - 2.1, t1: surgeT, gain: 0.24 },
  { k: 'braam', t: at('title'), f: 55, len: 3.6, gain: 0.32 },
];
CUES.music = { t0: at('finalRun'), open: surgeT, end: DURATION };
for (const sh of SHOTS) for (const tx of sh.texts || []) CUES.push({ k: 'tick', t: sh.start + tx.t0 });

function soundEvents() {
  const out = [];
  for (const sh of SHOTS) for (const [s, type, , gain] of sh.ev || []) if (type && type !== 'tick') out.push({ t: sh.start + s / (sh.slow || 1), type, gain });
  return out;
}

// ---------------- running the timeline ----------------
let cur = -1, simT = 0, shotT = 0, evDone = 0, hideOthers = [];
function enterShot(i) {
  const sh = SHOTS[i];
  cur = i; simT = 0; shotT = 0; evDone = 0;
  Math.random = mulberry32(1000 + i * 7919);
  for (const d of drones) scene.remove(d.m.group); drones.length = 0;
  for (const b of bolts) scene.remove(b.mesh); bolts.length = 0;
  emb.length = 0; emberLight.intensity = 0;
  effects.clear();
  for (const a of ACTORS) { a.on = false; a.hidden = false; a.flash = false; a.air = false; a.crouch = 0; a.aim = 0; a.pitch = 0; a.vel.set(0, 0, 0); a.r.setVisible(false); }
  for (const k of Object.keys(S)) delete S[k];
  if (sh.setup) sh.setup();
  // actors start where the shot needs them, with a moment of the same motion before it so the clips have settled
  for (const A of sh.actors || []) {
    const a = A.who; a.on = true; a.pos.copy(A.p); a.yaw = A.yaw; a.aim = A.aim || 0; a.crouch = A.crouch || 0;
    a.vel.copy(A.vel || V3()); a.r.face(Math.hypot(a.vel.x, a.vel.z) > 0.1 && !a.aim ? Math.atan2(-a.vel.x, -a.vel.z) : A.yaw);
    const back = a.vel.clone().multiplyScalar(-1.4);
    for (let k = 0; k < 42; k++) { const p0 = A.p.clone().addScaledVector(back, 1 - k / 42); a.pos.copy(p0); stepActor(a, 1 / FPS); }
    a.pos.copy(A.p);
  }
  if (sh.update) sh.update(0, 0, 0);
}
function advance(dt) {
  const sh = SHOTS[cur], slow = sh.slow || 1, ds = dt * slow;
  shotT += dt; simT += ds;
  for (const a of ACTORS) a.flash = false;
  const ev = sh.ev || [];
  while (evDone < ev.length && ev[evDone][0] <= simT + 1e-6) { const f = ev[evDone][2]; if (f) f(); evDone++; }
  if (sh.update) sh.update(shotT, simT, ds);
  for (const a of ACTORS) if (a.on) { stepActor(a, ds); a.r.setVisible(!a.hidden); }
  afterShots();
  // the Shade sheds embers as she stands
  if (shade.on && !shade.hidden) for (let k = 0; k < 3; k++) ember(shade.pos.clone().add(V3((Math.random() - 0.5) * 0.7, 0.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.7)), V3((Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.3, (Math.random() - 0.5) * 0.15), 1.2 + Math.random());
  updateDrones(ds); updateBolts(ds); updateEmbers(ds);
  effects.update(ds, camera);
  world.update(ds, sh.start + shotT, camera);
  camera.aspect = W / VH; camera.updateProjectionMatrix();
}
// sort each shot's events by time
for (const sh of SHOTS) if (sh.ev) sh.ev.sort((a, b) => a[0] - b[0]);
function seek(T) {
  const i = SHOTS.findIndex((s) => T < s.start + s.dur);
  const idx = i < 0 ? SHOTS.length - 1 : i;
  if (idx !== cur || SHOTS[idx].start + shotT > T + 1e-6) enterShot(idx);
  while (SHOTS[cur].start + shotT < T - 1e-6) advance(1 / FPS);
}

// ---------------- the frame: picture, bars, cards ----------------
const out = document.createElement('canvas'); out.width = W; out.height = H;
const g = out.getContext('2d');
function text(str, y, { size = 40, font = 'Cabinet Grotesk', weight = 600, track = 0.34, alpha = 1, color = '255,255,255' } = {}) {
  g.save(); g.font = `${weight} ${size}px "${font}", system-ui, sans-serif`; g.fillStyle = `rgba(${color},${alpha})`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${track * size}px`;
  g.fillText(str, W / 2 + (track * size) / 2, y); g.restore();
}
function drawFrame(T) {
  const sh = SHOTS[cur], t = T - sh.start;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (!sh.black) {
    renderer.toneMappingExposure = sh.exposure || 1;
    post.render(1 / FPS, { showGun: false, hurt: 0, lowHp: 0, ads: 0 });
    g.drawImage(renderer.domElement, 0, BAR);
    let fade = 0;
    if (sh.fadeIn) fade = Math.max(fade, 1 - ramp(t, 0, sh.fadeIn));
    if (fade > 0) { g.fillStyle = `rgba(0,0,0,${fade})`; g.fillRect(0, BAR, W, VH); }
    if (sh.flashOut) { const k = ramp(t, sh.flashOut[0], sh.flashOut[1]); if (k > 0) { g.fillStyle = `rgba(255,246,236,${k * k})`; g.fillRect(0, BAR, W, VH); } }
  }
  for (const tx of sh.texts || []) {
    const a = Math.min(ramp(t, tx.t0, tx.t0 + 0.45), 1 - ramp(t, tx.t1 - 0.35, tx.t1));
    if (a <= 0) continue;
    tx.lines.forEach((l, i) => { if (l) text(l, H / 2 - 26 + i * 64, { size: 44, alpha: a }); });
  }
  if (sh.title) {
    // the title card: the monolith's glow behind HAM
    const glow = g.createRadialGradient(W / 2, H / 2 - 40, 0, W / 2, H / 2 - 40, 620);
    const k = smooth(t, 0.1, 1.4) * (1 - ramp(t, sh.dur - 0.7, sh.dur)) * (0.9 + 0.1 * Math.sin(t * 2.4));
    glow.addColorStop(0, `rgba(255,120,40,${0.32 * k})`); glow.addColorStop(0.45, `rgba(255,90,30,${0.1 * k})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    const end = 1 - ramp(t, sh.dur - 0.7, sh.dur);
    text('HAM', H / 2 - 90, { size: 230, font: 'Bread Island', weight: 400, track: 0.08, alpha: smooth(t, 0.25, 1.1) * end });
    text("HOME'S A MAZE", H / 2 + 60, { size: 34, track: 0.5, alpha: smooth(t, 0.9, 1.6) * end });
    text('Find your way home.', H / 2 + 130, { size: 30, weight: 400, track: 0.04, alpha: smooth(t, 1.8, 2.5) * end * 0.85 });
    text('HAM3D.FUN', H / 2 + 250, { size: 22, track: 0.4, alpha: smooth(t, 2.7, 3.3) * end * 0.6, color: '255,190,150' });
  }
}

// ---------------- modes ----------------
async function ready() {
  await Promise.all(ACTORS.map((a) => a.r.load('', { glb: '../../assets/runner.glb', clips: '../../assets/runner-clips.json' })));
  her.r.setGun('marker'); shade.r.setGun('blinker');
  await Promise.all(['44px "Cabinet Grotesk"', '200px "Bread Island"'].map((f) => document.fonts.load(f).catch(() => {})));
  for (let i = 0; i < 200 && loading; i++) await new Promise((r) => setTimeout(r, 50));
  // compile everything once
  seek(at('charge') + 1); renderer.compile(scene, camera); post.render(1 / FPS, { showGun: false, hurt: 0, lowHp: 0, ads: 0 });
  cur = -1;
}
window.__trailer = { her, shade, seek, SHOTS, camera, drawFrame, out }; // for checks from the console
const status = (s) => { document.title = s; const el = document.getElementById('status'); if (el) el.textContent = s; };
await ready();
document.body.appendChild(out);

if (q.get('sheet')) {
  const times = (q.get('at') || '3,8,12,14,15,17,19,21,25,28,30,32,34,37,40,42,45').split(',').map(Number);
  const cols = +(q.get('cols') || 4), tw = 480, th = 270, sheet = document.createElement('canvas');
  sheet.width = cols * tw; sheet.height = Math.ceil(times.length / cols) * th;
  const sg = sheet.getContext('2d'); sg.font = '600 16px system-ui'; sg.fillStyle = '#fff';
  times.slice().sort((a, b) => a - b).forEach((T, i) => {
    seek(T); drawFrame(T);
    sg.drawImage(out, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
    sg.fillText(`${T.toFixed(2)}s ${SHOTS[cur].name}`, (i % cols) * tw + 10, Math.floor(i / cols) * th + 22);
  });
  out.remove(); document.body.appendChild(sheet); document.body.style.margin = 0;
  status('done');
} else if (q.get('record')) {
  status('scoring');
  const audio = await renderScore({ duration: DURATION, events: soundEvents(), cues: CUES, musicUrl: urls.music });
  const mp4 = createMp4({ width: W, height: H, fps: FPS, sampleRate: 48000, channels: 2 });
  const ve = new VideoEncoder({ output: (c, m) => mp4.addVideo(c, m), error: (e) => status('video error ' + e.message) });
  // variable bitrate, so a hard frame (a cut, an explosion) gets the bits it needs instead of going blocky
  ve.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 16e6, bitrateMode: 'variable', latencyMode: 'quality', framerate: FPS, avc: { format: 'avc' } });
  const ae = new AudioEncoder({ output: (c, m) => mp4.addAudio(c, m), error: (e) => status('audio error ' + e.message) });
  ae.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
  // audio: planar float32 in 1024-sample frames
  const L = audio.getChannelData(0), R = audio.getChannelData(1);
  for (let i = 0; i < audio.length; i += 1024) {
    const n = Math.min(1024, audio.length - i), data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
    ae.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data }));
  }
  const frames = Math.round(DURATION * FPS), t0 = performance.now();
  let lastShot = -1, sinceKey = 0;
  for (let f = 0; f < frames; f++) {
    const T = f / FPS; seek(T); drawFrame(T);
    const vf = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    // a fresh keyframe on every cut (built from the shot before, the first frames of a new shot came out blocky)
    const key = cur !== lastShot || sinceKey >= 60; lastShot = cur; sinceKey = key ? 1 : sinceKey + 1;
    ve.encode(vf, { keyFrame: key }); vf.close();
    while (ve.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
    if (f % 15 === 0) { status(`frame ${f}/${frames} ${((performance.now() - t0) / 1000 / (f + 1)).toFixed(2)}s/f`); await new Promise((r) => setTimeout(r, 0)); }
  }
  await ve.flush(); await ae.flush();
  const blob = mp4.finish();
  window.__mp4 = blob;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ham-trailer.mp4'; document.body.appendChild(a); a.click();
  status(`done ${(blob.size / 1e6).toFixed(1)} MB`);
} else {
  // live: press to play with sound
  status('click to play');
  let audioBuf = null;
  const play = async () => {
    removeEventListener('pointerdown', play);
    status('scoring');
    audioBuf = audioBuf || await renderScore({ duration: DURATION, events: soundEvents(), cues: CUES, musicUrl: urls.music });
    const ac = new AudioContext(), src = ac.createBufferSource(); src.buffer = audioBuf; src.connect(ac.destination);
    const from = +(q.get('t') || 0), start = ac.currentTime + 0.1; src.start(start, from);
    status('playing');
    const loop = () => { const T = from + ac.currentTime - start; if (T >= DURATION) return status('end'); if (T >= 0) { seek(T); drawFrame(T); } requestAnimationFrame(loop); };
    loop();
  };
  addEventListener('pointerdown', play);
  seek(+(q.get('t') || 0)); drawFrame(+(q.get('t') || 0));
}
