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
  const BUTT = V(0, 0.01, gunBox.max.z - 0.01);           // stock end (barrel runs along -z)
  const GRIP_WRIST = V(0, -0.085, 0.11);                   // where the right wrist sits behind the pistol grip
  const GUARD_WRIST = V(-0.055, -0.06, -0.27);             // left wrist under the handguard
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
    gun.position.copy(butt).addScaledVector(dir, -kick * 0.05).sub(BUTT.clone().applyQuaternion(gun.quaternion));
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

  /** ctx: { pos, yaw, pitch, speed, back, aim (0..1), kick, flash } */
  r.update = (dt, ctx) => {
    if (!r.ready) return;
    root.position.copy(ctx.pos);
    root.rotation.set(0, ctx.yaw + Math.PI, 0);

    // locomotion: idle / walk / run by ground speed, played backwards when backing up
    const sp = ctx.speed, dirSign = ctx.back ? -1 : 1;
    if (sp < 0.4) play('idle', 1);
    else if (sp < 4.2) play('walk', dirSign * THREE.MathUtils.clamp(sp / 1.7, 0.7, 2));
    else play('run', dirSign * THREE.MathUtils.clamp(sp / 5.2, 0.85, 1.8));
    mixer.update(dt);
    root.updateMatrixWorld(true);

    const up = V(0, 1, 0);
    const fwd = V(-Math.sin(ctx.yaw), 0, -Math.cos(ctx.yaw));
    const right = V(Math.cos(ctx.yaw), 0, -Math.sin(ctx.yaw));
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
    reach(bones.LeftArm, bones.LeftForeArm, bones.LeftHand, gun.localToWorld(GUARD_WRIST.clone()), right.clone().multiplyScalar(-0.4).addScaledVector(up, -1));
    orientHand('Left', gRight.clone().multiplyScalar(0.75).addScaledVector(gUp, 0.55).addScaledVector(dir, 0.25), dir);
    curl('Right', [64, 135, 195], true);
    curl('Left', [55, 115, 165], false);
    point(bones.Head, bones.HeadTop_End, up.clone().addScaledVector(view, 0.12 + 0.1 * ctx.aim));

    flash.visible = ctx.flash;
    if (flash.visible) { flash.material.rotation = Math.random() * 6.28; flash.scale.setScalar(0.14 + Math.random() * 0.08); }
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
