// Bakes the runner's animation clips: retargets Mixamo's rifle set (design/character/clips/*.fbx,
// downloaded from mixamo.com "Without Skin", 30 fps) onto hamrunner.glb and writes them as plain
// three.js clip JSON, so the game loads them with the model and never fetches anything at runtime.
// The rifle clips carry the whole hold (arms, elbows, fingers), so the game only places the gun.
// Run: node design/character/bake-clips.mjs   ->  assets/runner.glb, assets/runner-clips.json
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const DIR = 'design/character/clips/';
const CLIPS = {
  idle: 'Rifle Idle.fbx', aim: 'Rifle Aiming Idle.fbx', walk: 'Rifle Walk.fbx', run: 'Rifle Run.fbx',
  reload: 'Reloading.fbx', jump: 'Rifle Jump.fbx', crouch: 'Idle Crouching.fbx',
  // pistol set (the runner borrows the rifle legs for what's missing: walk, jump; reload is posed in code)
  pistolAim: 'Pistol Idle.fbx', pistolRun: 'Pistol Run.fbx', pistolCrouch: 'Pistol Kneeling Idle.fbx',
};

const parse = (buf) => new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const P = (o) => o.getWorldPosition(new THREE.Vector3());
const Q = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const boneMap = (root) => { const m = {}; root.traverse((o) => { if (o.isBone) m[o.name.replace(/^mixamorig:?/, '')] = o; }); return m; };

// Same as the preview page: turn a rig so hips->head is +y and the chest faces +z, at a set height.
function standUp(wrap, root, b, height) {
  wrap.updateMatrixWorld(true);
  const up = P(b.Head).sub(P(b.Hips)).normalize();
  const side = P(b.RightArm).sub(P(b.LeftArm)).normalize();
  const fwd = new THREE.Vector3().crossVectors(side, up).normalize().negate();
  side.crossVectors(up, fwd).normalize().negate();
  wrap.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side.clone().negate(), up, fwd)).invert();
  wrap.updateMatrixWorld(true);
  // a skeleton-only file (Mixamo "Without Skin") has no mesh to measure, so use the joints: head top to toes
  let box = new THREE.Box3().setFromObject(root, true);
  if (box.isEmpty()) { box = new THREE.Box3(); root.traverse((o) => { if (o.isBone) box.expandByPoint(P(o)); }); }
  wrap.scale.setScalar(height / (box.max.y - box.min.y));
  wrap.updateMatrixWorld(true);
}

// World-space retarget (see design/character/index.html for the reasoning).
function retarget(clip, model, bones, rest, src, sb, sRest) {
  const order = [];
  model.traverse((o) => { if (o.isBone) { const k = o.name.replace(/^mixamorig:?/, ''); if (sb[k] && rest[k]) order.push(k); } });
  const keyOf = new Map(order.map((k) => [bones[k], k]));
  const fixedParent = {};
  for (const k of order) if (!keyOf.has(bones[k].parent)) fixedParent[k] = Q(bones[k].parent);
  const hipsToLocal = bones.Hips.parent.matrixWorld.clone().invert();
  const mx = new THREE.AnimationMixer(src);
  mx.clipAction(clip).play();
  const fps = 30, n = Math.max(2, Math.ceil(clip.duration * fps) + 1);
  const times = new Float32Array(n), hips = new Float32Array(n * 3), out = {};
  for (const k of order) out[k] = new Float32Array(n * 4);
  const world = {}, inv = new THREE.Quaternion(), loc = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const t = Math.min(i / fps, clip.duration);
    times[i] = t;
    mx.setTime(t);
    src.updateMatrixWorld(true);
    for (const k of order) {
      const w = Q(sb[k]).multiply(inv.copy(sRest[k].q).invert()).multiply(rest[k].q);
      world[k] = w;
      const pw = keyOf.has(bones[k].parent) ? world[keyOf.get(bones[k].parent)] : fixedParent[k];
      loc.copy(pw).invert().multiply(w);
      if (i && loc.x * out[k][i * 4 - 4] + loc.y * out[k][i * 4 - 3] + loc.z * out[k][i * 4 - 2] + loc.w * out[k][i * 4 - 1] < 0) loc.set(-loc.x, -loc.y, -loc.z, -loc.w);
      loc.toArray(out[k], i * 4);
    }
    // drop the clip's forward travel (Mixamo walks along +z) in the source's own frame, where y is
    // exactly up: dropping it after standing the rig up let a degree or two of lean turn the forward
    // travel into a slow rise that snapped down at each loop (the walk's upward glitch)
    const own = src.parent, hl = own.worldToLocal(P(sb.Hips)), rl = own.worldToLocal(sRest.Hips.p.clone());
    hl.z = rl.z;
    const dp = own.localToWorld(hl).sub(sRest.Hips.p);
    rest.Hips.p.clone().add(dp).applyMatrix4(hipsToLocal).toArray(hips, i * 3);
  }
  const round = (a, d) => Array.from(a, (v) => Math.round(v * d) / d);
  const tracks = order.map((k) => new THREE.QuaternionKeyframeTrack(bones[k].name + '.quaternion', round(times, 1e4), round(out[k], 1e4)));
  tracks.push(new THREE.VectorKeyframeTrack(bones.Hips.name + '.position', round(times, 1e4), round(hips, 1e4)));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const own = await parse(fs.readFileSync('design/character/hamrunner.glb'));
const model = own.scene, bones = boneMap(model);
const wrap = new THREE.Group(); wrap.add(model); standUp(wrap, model, bones, 1.75);
const rest = {}; for (const [k, b] of Object.entries(bones)) rest[k] = { q: Q(b), p: P(b) };

const out = {};
for (const [key, file] of Object.entries(CLIPS)) {
  const buf = fs.readFileSync(DIR + file);
  const src = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const sb = boneMap(src);
  // measure the skeleton in its T-pose rest (all the Mixamo files share it), standing the same way as hers
  const sw = new THREE.Group(); sw.add(src); standUp(sw, src, sb, 1.75);
  const sRest = {}; for (const [k, b] of Object.entries(sb)) sRest[k] = { q: Q(b), p: P(b) };
  const clip = src.animations[0];
  clip.name = key;
  out[key] = THREE.AnimationClip.toJSON(retarget(clip, model, bones, rest, src, sb, sRest));
  console.log(key.padEnd(7), file.padEnd(24), clip.duration.toFixed(2) + 's');
}
fs.writeFileSync('assets/runner-clips.json', JSON.stringify(out));
fs.copyFileSync('design/character/hamrunner.glb', 'assets/runner.glb');
console.log('wrote assets/runner-clips.json', (fs.statSync('assets/runner-clips.json').size / 1024).toFixed(0), 'KB, assets/runner.glb');
