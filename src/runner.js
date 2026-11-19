// The runner: the player's own body for third person. hamrunner.glb with Mixamo idle / walk / run
// (baked onto this rig by design/character/bake-clips.mjs), shaded like the HAM art: near-black gloss
// with a neon rim, holding the same K-7 the first-person view uses. Aim and carry are posed in code on
// top of the clips: the gun is placed first (shouldered along the view when aiming, low ready when
// not), then both arms reach for it with two-bone IK and the fingers close around grip and handguard.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildGun, BORE } from './gunmodel.js';

const HEIGHT = 1.75;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = (o) => o.getWorldPosition(new THREE.Vector3());
const Q = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const DEG = Math.PI / 180;

/** Near-black gloss with a fresnel rim that blooms: the look of the HAM renders. */
export function rimMaterial({ color = 0x07060a, rim = 0x5ff4ff, power = 4.2, strength = 1.9 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  const uniforms = { uRim: { value: new THREE.Color(rim) }, uRimPow: { value: power }, uRimStr: { value: strength } };
  m.userData.rim = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimPow; uniform float uRimStr;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPow);\n  totalEmissiveRadiance += uRim * rimF * uRimStr;');
  };
  m.customProgramCacheKey = () => 'ham-rim';
  return m;
}

// ---- hair cards: lashes and brows ----
// The rig ships its lashes and brows as MakeHuman cards (curved strips meant to be cut out by an alpha
// texture) but with no texture, so they render as solid bands over the eyes. Each card gets a
// coordinate (s along the lid, t from root 0 to tip 1) and the shader cuts it into strands: thick at the
// lid, tapering, each a random length. Alpha-tested, so no sorting.
function cardCoords(mesh, skull) {
  const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
  const n = pos.count, parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let k = 0; k < idx.count; k += 3) { const a = find(idx.getX(k)); parent[find(idx.getX(k + 1))] = a; parent[find(idx.getX(k + 2))] = a; }
  mesh.updateMatrixWorld(true);
  const d = new Float32Array(n), v = new THREE.Vector3(), lo = {}, hi = {};
  for (let i = 0; i < n; i++) {
    d[i] = v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).distanceTo(skull);
    const c = find(i); lo[c] = Math.min(lo[c] ?? Infinity, d[i]); hi[c] = Math.max(hi[c] ?? -Infinity, d[i]);
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { const c = find(i); out[i * 2] = uv.getX(i); out[i * 2 + 1] = (d[i] - lo[c]) / Math.max(1e-6, hi[c] - lo[c]); }
  g.setAttribute('aCard', new THREE.BufferAttribute(out, 2));
}

const CUT = {
  // ~65 lashes per lid, slanted a touch, solid lash line at the root
  lash: `float x = vCard.x * 120.0 + vCard.y * 0.8; float id = floor(x);
    float h = fract(sin(id * 12.9898) * 43758.5453);
    float len = 0.55 + 0.45 * h, w = mix(0.42, 0.12, clamp(vCard.y / len, 0.0, 1.0));
    if (vCard.y > 0.12 && (vCard.y > len || abs(fract(x) - 0.5) > w)) discard;`,
  // short slanted strokes, sparse at the edges of the brow
  brow: `float x = vCard.x * 95.0 + vCard.y * 1.6; float id = floor(x);
    float h = fract(sin(id * 78.233) * 43758.5453), h2 = fract(h * 91.7);
    if (abs(fract(x) - 0.5) > 0.36 || vCard.y < 0.12 * h2 || vCard.y > 0.6 + 0.4 * h) discard;`,
};
function cardMaterial(kind, rim) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x050407, roughness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: new THREE.Color(rim) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aCard; varying vec2 vCard;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vCard = aCard;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCard; uniform vec3 uRim;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  { ${CUT[kind]} }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uRim * (pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0) * 0.6 + smoothstep(0.25, 1.0, vCard.y) * 0.35);');
  };
  m.customProgramCacheKey = () => 'ham-card-' + kind;
  return m;
}

function boneMap(root) { const m = {}; root.traverse((o) => { if (o.isBone) m[o.name.replace(/^mixamorig:?/, '')] = o; }); return m; }

// turn a rig so hips->head is +y and the chest faces +z, at HEIGHT metres, feet on y = 0
function standUp(wrap, root, b) {
  wrap.updateMatrixWorld(true);
  const up = P(b.Head).sub(P(b.Hips)).normalize();
  const side = P(b.RightArm).sub(P(b.LeftArm)).normalize();
  const fwd = new THREE.Vector3().crossVectors(side, up).normalize().negate();
  side.crossVectors(up, fwd).normalize().negate();
  wrap.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side.clone().negate(), up, fwd)).invert();
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  wrap.scale.setScalar(HEIGHT / (box.max.y - box.min.y));
  wrap.updateMatrixWorld(true);
  box.setFromObject(root, true);
  const c = box.getCenter(new THREE.Vector3());
  wrap.position.set(-c.x, -box.min.y, -c.z);
}

// ---- pose helpers (world space) ----
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion();
function setWorldQuat(bone, wq) {
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(wq));
  bone.updateMatrixWorld(true);
}
function point(bone, child, dir) {
  const a = P(bone), b = P(child);
  _q.setFromUnitVectors(b.sub(a).normalize(), dir.clone().normalize());
  setWorldQuat(bone, Q(bone).premultiply(_q));
}
function turn(bone, axis, angle) { setWorldQuat(bone, Q(bone).premultiply(_q.setFromAxisAngle(axis, angle))); }
function reach(arm, fore, hand, target, pole) {
  const S = P(arm), a = P(fore).distanceTo(S), b = P(hand).distanceTo(P(fore));
  const d = target.clone().sub(S);
  const dist = Math.min(Math.max(d.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const dir = d.normalize();
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const side = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const E = S.clone().addScaledVector(dir, cosA * a).addScaledVector(side, Math.sqrt(Math.max(0, 1 - cosA * cosA)) * a);
  point(arm, fore, E.clone().sub(S));
  point(fore, hand, S.addScaledVector(dir, dist).sub(P(fore)));
}

export function createRunner(scene) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const { group: gun, flash } = buildGun();
  gun.visible = false; scene.add(gun);
  gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const gunBox = new THREE.Box3().setFromObject(gun);
  // the K-7 is the first-person viewmodel, built chunky to read up close; on the body it needs shrinking.
  // Every offset below is in the gun's own space, so the hands follow the scale.
  const GUN_SCALE = 0.72;
  gun.scale.setScalar(GUN_SCALE);
  const BUTT = V(0, 0.01, gunBox.max.z - 0.01);           // stock end (barrel runs along -z)
  const GRIP_WRIST = V(0, -0.085, 0.11);                   // where the right wrist sits behind the pistol grip
  const GUARD_WRIST = V(-0.12, -0.12, -0.3);          // left wrist under the handguard
  const MUZZLE = V(0, BORE, -0.66);

  const r = { root, gun, ready: false, failed: false, show: false };
  let model, mixer, bones, actions = {}, current = null;

  r.load = async (base = '') => {
    try {
      const [gltf, clips] = await Promise.all([
        new GLTFLoader().loadAsync(`${base}/models/runner.glb`),
        fetch(`${base}/models/runner-clips.json`).then((res) => { if (!res.ok) throw new Error('clips ' + res.status); return res.json(); }),
      ]);
      model = gltf.scene;
      const mat = rimMaterial();
      model.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.frustumCulled = false; } });
      bones = boneMap(model);
      const wrap = new THREE.Group(); wrap.add(model); root.add(wrap);
      standUp(wrap, model, bones);
      // lashes and brows: cut into strands (see cardCoords); skull centre between Head and its tip
      const skull = P(bones.Head).lerp(P(bones.HeadTop_End), 0.45);
      model.traverse((o) => {
        const kind = /eyelash/i.test(o.name) ? 'lash' : /eyebrow/i.test(o.name) ? 'brow' : null;
        if (o.isMesh && kind && o.geometry.attributes.uv) { cardCoords(o, skull); o.material = cardMaterial(kind, 0x5ff4ff); o.castShadow = false; }
      });
      mixer = new THREE.AnimationMixer(model);
      for (const [k, json] of Object.entries(clips)) actions[k] = mixer.clipAction(THREE.AnimationClip.parse(json));
      current = actions.idle; current.play();
      r.ready = true;
    } catch (e) { r.failed = true; console.warn('runner model unavailable', e); }
    return r.ready;
  };

  r.setVisible = (v) => { r.show = v; root.visible = v && r.ready; gun.visible = v && r.ready; };

  function play(name, timeScale) {
    const next = actions[name];
    if (!next) return;
    if (next !== current) { next.reset().setEffectiveWeight(1).fadeIn(0.22).play(); current.fadeOut(0.22); current = next; }
    next.timeScale = timeScale;
  }

  // gun basis: barrel (-z) along `dir`, up as close to world up as it can be
  const _m = new THREE.Matrix4();
  function placeGun(dir, butt, kick) {
    const z = dir.clone().negate().normalize();
    const y = V(0, 1, 0).addScaledVector(z, -z.y).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    gun.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
    gun.position.copy(butt).addScaledVector(dir, -kick * 0.05).sub(BUTT.clone().multiplyScalar(GUN_SCALE).applyQuaternion(gun.quaternion));
    gun.updateMatrixWorld(true);
  }
  function orientHand(side, fD, aD) {
    const hand = bones[side + 'Hand'];
    const w = P(hand), mid = P(bones[side + 'HandMiddle1']);
    const f = mid.sub(w).normalize();
    const a = P(bones[side + 'HandIndex1']).sub(P(bones[side + 'HandPinky1'])); a.addScaledVector(f, -a.dot(f)).normalize();
    const fd = fD.clone().normalize(), ad = aD.clone().addScaledVector(fd, -aD.dot(fd)).normalize();
    const m1 = new THREE.Matrix4().makeBasis(f, a, new THREE.Vector3().crossVectors(f, a));
    const m2 = new THREE.Matrix4().makeBasis(fd, ad, new THREE.Vector3().crossVectors(fd, ad));
    _q.setFromRotationMatrix(m2.multiply(m1.transpose()));
    setWorldQuat(hand, Q(hand).premultiply(_q));
  }
  function curl(side, bend, trigger) {
    const s = side === 'Right' ? -1 : 1;
    const w = P(bones[side + 'Hand']), f = P(bones[side + 'HandMiddle1']).sub(w).normalize();
    const a = P(bones[side + 'HandIndex1']).sub(P(bones[side + 'HandPinky1'])); a.addScaledVector(f, -a.dot(f)).normalize();
    const n = new THREE.Vector3().crossVectors(f, a).multiplyScalar(s).normalize();
    const at = (deg) => f.clone().multiplyScalar(Math.cos(deg * DEG)).addScaledVector(n, Math.sin(deg * DEG));
    for (const name of ['Index', 'Middle', 'Ring', 'Pinky']) {
      const b = [1, 2, 3, 4].map((i) => bones[`${side}Hand${name}${i}`]);
      if (!b[3]) continue;
      const angles = trigger && name === 'Index' ? [6, 12, 18] : bend;
      for (let i = 0; i < 3; i++) point(b[i], b[i + 1], at(angles[i]));
    }
    const th = [2, 3, 4].map((i) => bones[`${side}HandThumb${i}`]);
    if (th[2]) { point(th[0], th[1], at(40)); point(th[1], th[2], at(65)); }
  }

  // Body facing is her own, apart from the camera (the free-orbit third person of open-world
  // shooters): she turns to the way she moves and keeps it when she stops, so the camera can swing
  // round to her face. Aiming or firing turns her to the camera, so shots leave where you look.
  let bodyYaw = null, airT = 0, stance = 0.4;
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  /** ctx: { pos, vel, yaw, pitch, speed, aim (0..1), kick, flash } (yaw/pitch: the camera's) */
  r.update = (dt, ctx) => {
    if (!r.ready) return;
    if (bodyYaw === null) bodyYaw = ctx.yaw;
    const sp = ctx.speed;
    let rate = 0, target = bodyYaw;
    if (ctx.aim > 0.05 || ctx.flash) { target = ctx.yaw; rate = ctx.flash ? 40 : 16; }
    else if (sp > 0.4) { target = Math.atan2(-ctx.vel.x, -ctx.vel.z); rate = 9; }
    bodyYaw = wrapAngle(bodyYaw + wrapAngle(target - bodyYaw) * (1 - Math.exp(-rate * dt)));
    root.position.copy(ctx.pos);
    // bladed stance: hips and chest turned right so the left shoulder leads and the support hand can
    // reach out along the handguard (square to the target, the left arm cannot get there)
    stance += ((sp > 0.4 ? 0.22 : 0.42) + 0.2 * ctx.aim - stance) * (1 - Math.exp(-8 * dt));
    root.rotation.set(0, bodyYaw + Math.PI - stance, 0);

    // locomotion: idle / walk / run by ground speed; backing up only happens while aiming
    const along = -Math.sin(bodyYaw) * ctx.vel.x - Math.cos(bodyYaw) * ctx.vel.z;
    const dirSign = along < -0.5 ? -1 : 1;
    if (sp < 0.4) play('idle', 1);
    else if (sp < 4.2) play('walk', dirSign * THREE.MathUtils.clamp(sp / 1.7, 0.7, 2));
    else play('run', dirSign * THREE.MathUtils.clamp(sp / 5.2, 0.85, 1.8));
    mixer.update(dt);
    root.updateMatrixWorld(true);

    const up = V(0, 1, 0);
    const fwd = V(-Math.sin(bodyYaw), 0, -Math.cos(bodyYaw));
    const right = V(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));

    // crouch and jump, posed on top of the clips (the clip library has neither): crouching drops the
    // hips and the legs bend to keep the feet where the clip put them; in the air the feet tuck up.
    const k = 1 - Math.exp(-10 * dt);
    airT += ((ctx.air ? 1 : 0) - airT) * k;
    const c = THREE.MathUtils.clamp(ctx.crouch || 0, 0, 1);
    if (c > 0.01 || airT > 0.01) {
      const feet = ['Left', 'Right'].map((s) => ({ s, p: P(bones[s + 'Foot']), q: Q(bones[s + 'Foot']) }));
      root.position.y -= 0.46 * c;
      root.updateMatrixWorld(true);
      turn(bones.Spine, right, -0.32 * c);
      for (const f of feet) {
        const target = f.p.addScaledVector(up, 0.32 * airT).addScaledVector(fwd, 0.08 * airT);
        const out = right.clone().multiplyScalar(f.s === 'Left' ? -0.15 : 0.15);
        reach(bones[f.s + 'UpLeg'], bones[f.s + 'Leg'], bones[f.s + 'Foot'], target, fwd.clone().add(out));
        setWorldQuat(bones[f.s + 'Foot'], f.q);
      }
    }
    const view = V(-Math.sin(ctx.yaw) * Math.cos(ctx.pitch), Math.sin(ctx.pitch), -Math.cos(ctx.yaw) * Math.cos(ctx.pitch));

    // lean the chest with the view so the gun can follow it up and down
    turn(bones.Spine1, right, ctx.pitch * 0.22 * ctx.aim);
    turn(bones.Spine2, right, ctx.pitch * 0.22 * ctx.aim);

    // gun: shouldered along the view when aiming, low ready (down and across) otherwise
    const shoulder = P(bones.RightArm);
    const low = fwd.clone().multiplyScalar(Math.cos(32 * DEG)).addScaledVector(up, -Math.sin(32 * DEG)).addScaledVector(right, -0.28).normalize();
    const dir = low.lerp(view, ctx.aim).normalize();
    const butt = shoulder.clone()
      .addScaledVector(up, -0.035 - 0.1 * (1 - ctx.aim))
      .addScaledVector(fwd, 0.05)
      .addScaledVector(right, -0.03 - 0.04 * (1 - ctx.aim));
    placeGun(dir, butt, ctx.kick);

    // arms to the gun, elbows dropped and a little out
    reach(bones.RightArm, bones.RightForeArm, bones.RightHand, gun.localToWorld(GRIP_WRIST.clone()), right.clone().multiplyScalar(0.6).addScaledVector(up, -1));
    const gUp = up.clone().applyQuaternion(gun.quaternion), gRight = V(1, 0, 0).applyQuaternion(gun.quaternion);
    orientHand('Right', dir.clone().addScaledVector(gUp, -0.55), gUp);
    reach(bones.LeftArm, bones.LeftForeArm, bones.LeftHand, gun.localToWorld(GUARD_WRIST.clone()), right.clone().multiplyScalar(-0.75).addScaledVector(up, -1));
    // support hand cups the handguard from below: palm up, fingers across and up the far side
    orientHand('Left', gRight.clone().multiplyScalar(0.85).addScaledVector(gUp, 0.45).addScaledVector(dir, 0.2), dir);
    curl('Right', [64, 135, 195], true);
    curl('Left', [55, 115, 165], false);
    // head: looks where she walks, and down the sights when aiming
    point(bones.Head, bones.HeadTop_End, up.clone().addScaledVector(fwd.clone().lerp(view, ctx.aim), 0.12 + 0.1 * ctx.aim));

    flash.visible = ctx.flash;
    if (flash.visible) { flash.material.rotation = Math.random() * 6.28; flash.scale.setScalar((0.14 + Math.random() * 0.08) / GUN_SCALE); }
  };

  r.muzzle = () => gun.localToWorld(MUZZLE.clone());
  return r;
}

/** Over-the-shoulder camera: behind and right of the head, pulled in so walls never block it. */
export function createThirdCam(world) {
  let dist = 2.6;
  const pivot = new THREE.Vector3(), off = new THREE.Vector3(), d = new THREE.Vector3();
  return (camera, player, ads, dt) => {
    const yaw = player.yaw, pitch = player.pitch;
    const back = V(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = V(Math.cos(yaw), 0, -Math.sin(yaw));
    pivot.set(player.pos.x, player.pos.y + player.eye + 0.05, player.pos.z);
    const want = 2.7 - ads * 1.25;
    off.copy(back).multiplyScalar(want).addScaledVector(right, 0.62 - ads * 0.12).y += 0.12;
    const len = off.length();
    d.copy(off).divideScalar(len);
    const hit = world.raycast(pivot, d, len + 0.3);
    const allowed = hit ? Math.max(0.35, hit.t - 0.3) : len;
    dist += ((Math.min(len, allowed)) - dist) * (allowed < dist ? 1 : 1 - Math.exp(-6 * dt));
    camera.position.copy(pivot).addScaledVector(d, dist);
  };
}
