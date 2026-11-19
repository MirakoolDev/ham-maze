// The runner: the player's own body for third person. hamrunner.glb with Mixamo's rifle set
// (idle, aiming idle, walk, run, reload, jump, crouch; baked onto this rig by
// design/character/bake-clips.mjs), shaded like the HAM art: near-black gloss with a neon rim, holding
// the same K-7 the first-person view uses. The clips carry the whole hold, arms and fingers included,
// the way a game engine plays authored weapon animations; the code only places the gun between the
// hands, lays aim and reload over the upper body, and offers small tweaks on top.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildGun, BORE } from './gunmodel.js';
import { NFT_GUNS, buildNftGun } from './nftguns.js';

const HEIGHT = 1.75;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = (o) => o.getWorldPosition(new THREE.Vector3());
const Q = (o) => o.getWorldQuaternion(new THREE.Quaternion());
const DEG = Math.PI / 180;

/** Near-black gloss with a fresnel glow, built like a Blender Layer Weight (facing) into emission:
 *  a wide soft falloff in the rim colour that fades in toward the silhouette, and a thin bright edge
 *  that goes toward white. Both are emission, so the game's bloom turns them into light. */
export function rimMaterial({ color = 0x07060a, rim = 0x5ff4ff, edge = 0xeafcff, power = 1.8, strength = 1.1, edgePower = 6, edgeStrength = 1.7 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  const uniforms = {
    uRim: { value: new THREE.Color(rim) }, uRimPow: { value: power }, uRimStr: { value: strength },
    uEdge: { value: new THREE.Color(edge) }, uEdgePow: { value: edgePower }, uEdgeStr: { value: edgeStrength },
  };
  m.userData.rim = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimPow; uniform float uRimStr; uniform vec3 uEdge; uniform float uEdgePow; uniform float uEdgeStr;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float facing = 1.0 - saturate(abs(dot(normal, normalize(vViewPosition))));
  totalEmissiveRadiance += uRim * smoothstep(0.15, 1.0, pow(facing, uRimPow)) * uRimStr;
  totalEmissiveRadiance += uEdge * pow(facing, uEdgePow) * uEdgeStr;`);
  };
  m.customProgramCacheKey = () => 'ham-rim2';
  return m;
}

/** Translucent glow: a milky see-through body lit from inside, brightest at the edges (the glowing
 *  translucent objects of the HAM renders). Transmission lets the room tint through; the fresnel rim is
 *  added as emission so it reads as light, not paint. */
// Kept below the bloom threshold over the body (only the outer edge blooms): brighter settings lit the
// whole figure past it and the bloom washed into the room.
export function glowMaterial({ color = '#cfcadc', tint = '#cfe6ff', rim = '#ffffff', glow = '#e6efff', transmission = 0.55, power = 2.8, strength = 0.95, core = 0.05 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.22, metalness: 0, transmission, thickness: 0.45, ior: 1.3,
    attenuationColor: new THREE.Color(tint), attenuationDistance: 0.7,
    clearcoat: 1, clearcoatRoughness: 0.12, emissive: new THREE.Color(glow), emissiveIntensity: core,
    sheen: 0.25, sheenColor: new THREE.Color(rim), sheenRoughness: 0.4,
  });
  const uniforms = { uRim: { value: new THREE.Color(rim) }, uRimPow: { value: power }, uRimStr: { value: strength } };
  m.userData.rim = uniforms;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim; uniform float uRimPow; uniform float uRimStr;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPow);\n  totalEmissiveRadiance += uRim * rimF * uRimStr;');
  };
  m.customProgramCacheKey = () => 'ham-glow';
  return m;
}

/** Body looks: the body material and the eyes' light. */
export const LOOKS = {
  rim: { name: 'Blue glow', body: () => rimMaterial(), eyes: '#9ff8ff' },
  pearl: { name: 'Pearl glow', body: () => glowMaterial(), eyes: '#bff8ff' },

  pink: { name: 'Pink glow', body: () => glowMaterial({ color: '#e8bccb', tint: '#ff9cbc', rim: '#ffe6ee', glow: '#ff6fa3', core: 0.07 }), eyes: '#ffffff' },
  frost: { name: 'Frost glass', body: () => glowMaterial({ color: '#c9dcea', tint: '#8fd4ff', rim: '#dff6ff', glow: '#5fd0ff', transmission: 0.75, core: 0.05 }), eyes: '#5ff4ff' },
  ember: { name: 'Ember (Blender export)', body: () => rimMaterial({ rim: 0xff5a2e, edge: 0xffe2d0 }), eyes: '#ffb08a' },
};

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

/** The hold. Positions are in the gun's own space (barrel along -z, x to its right, y up). */
// every gun she can carry: the K-7 and the Power-Up guns
export const GUNS = { k7: { name: 'K-7', kind: 'rifle' }, ...NFT_GUNS };

export const HOLD = {
  gunScale: 0.95,                                   // near a real rifle on her; the slim grip fits her hand
  // where each wrist sits on the gun: the gun hangs from the right wrist and points toward the left
  gripX: 0, gripY: -0.085, gripZ: 0.1,
  supportX: -0.02, supportY: -0.035, supportZ: -0.3,
  gunRoll: 0, gunYaw: 0, gunPitch: 0,               // degrees, on top of what the hands give
  supportPull: 1,                                   // 0..1: pull the left hand exactly onto its spot
  // posture on top of the clips (degrees): the rifle set is a man's mocap; these soften it
  hipSway: 6,                                       // pelvis drops on the swinging side while walking / running
  narrow: 3,                                        // legs drawn in toward the centre line (steps closer to one line)
  chestLift: 4,                                     // chest up and back
  shoulderDrop: 3,                                  // shoulders down and relaxed
  // the pistols (src/nftguns.js; the Power-Up rifles share the K-7's layout and hold): size, where the
  // grip sits in the fist, and the carry when not aiming (gun down by her right leg, left arm relaxed)
  nftScale: 1,
  pGripAlong: 0.62, pGripDepth: 0.015,              // along the palm from wrist to knuckles; off the palm
  pRoll: 0, pYaw: 0, pPitch: 0,                     // degrees, on top of the fist
  pCarryOut: 0.03, pCarryFwd: 0.04,                 // metres the gun hand hangs out from the shoulder line, and forward
  pCarryTilt: 25,                                   // degrees the barrel points forward of straight down
  pSwing: 0.35,                                     // arm swing with the stride
  // fingers, degrees added to the clip's own grip (curl closes toward the palm)
  rCurl: 0, rSpread: 0, rIndex: 0, rMiddle: 0, rRing: 0, rPinky: 0,
  rThumbBend: 0, rThumbAcross: 0, rThumbOut: 0, rThumbTwist: 0,
  lCurl: 0, lSpread: 0, lIndex: 0, lMiddle: 0, lRing: 0, lPinky: 0,
  lThumbBend: 0, lThumbAcross: 0, lThumbOut: 0, lThumbTwist: 0,
};

// bones the aim and reload clips drive (everything above the hips)
const UPPER = /^(Spine|Neck|Head|LeftShoulder|RightShoulder|LeftArm|RightArm|LeftForeArm|RightForeArm|LeftHand|RightHand)/;

export function createRunner(scene, opts = {}) {
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const GRIP = V(), GUARD = V();

  const r = { root, gun: null, ready: false, failed: false, show: false, hold: { ...HOLD }, holdWeight: 0, look: opts.look || 'rim', gunId: 'k7', kind: 'rifle' };
  // the gun in her hands: the K-7 (rifle) or one of the Power-Up guns (rifle or pistol, src/nftguns.js)
  let gun, flash, MUZZLE, FIST = null, nft = false;
  r.setGun = (id) => {
    if (gun) scene.remove(gun);
    if (NFT_GUNS[id]) {
      const b = buildNftGun(id);
      ({ group: gun, flash } = b); MUZZLE = b.muzzle; FIST = b.fist; nft = true; r.kind = b.kind; r.gunId = id;
    } else {
      ({ group: gun, flash } = buildGun({ slim: true })); MUZZLE = V(0, BORE, -0.66); FIST = null; nft = false; r.kind = 'rifle'; r.gunId = 'k7';
    }
    gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    gun.visible = r.show && r.ready; scene.add(gun); r.gun = gun;
    reloadT = -1;
  };
  let model, mixer, bones, actions = {}, current = null, clipPose = null;
  const overlays = {};

  r.load = async (base = '', urls = {}) => {
    try {
      const [gltf, clips] = await Promise.all([
        new GLTFLoader().loadAsync(urls.glb || `${base}/models/runner.glb`),
        fetch(urls.clips || `${base}/models/runner-clips.json`).then((res) => { if (!res.ok) throw new Error('clips ' + res.status); return res.json(); }),
      ]);
      model = gltf.scene;
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
      bones = boneMap(model);
      const wrap = new THREE.Group(); wrap.add(model); root.add(wrap);
      standUp(wrap, model, bones);
      // lashes and brows: cut into strands (see cardCoords); skull centre between Head and its tip
      const skull = P(bones.Head).lerp(P(bones.HeadTop_End), 0.45);
      model.traverse((o) => {
        const kind = /eyelash/i.test(o.name) ? 'lash' : /eyebrow/i.test(o.name) ? 'brow' : null;
        if (o.isMesh && kind && o.geometry.attributes.uv) { cardCoords(o, skull); o.material = cardMaterial(kind, 0x5ff4ff); o.castShadow = false; }
      });
      r.setLook(r.look);
      mixer = new THREE.AnimationMixer(model);
      for (const [k, json] of Object.entries(clips)) {
        const clip = THREE.AnimationClip.parse(json);
        actions[k] = mixer.clipAction(clip);
        // upper-body samplers for the clips laid over the legs (aim, reload)
        overlays[k] = {
          duration: clip.duration,
          tracks: clip.tracks.filter((t) => t.name.endsWith('.quaternion')).map((t) => {
            const name = t.name.replace(/\.quaternion$/, '').replace(/^mixamorig:?/, '');
            return UPPER.test(name) && bones[name] ? { bone: bones[name], it: t.createInterpolant() } : null;
          }).filter(Boolean),
        };
      }
      if (actions.jump) { actions.jump.setLoop(THREE.LoopOnce, 1); actions.jump.clampWhenFinished = true; }
      current = actions.idle; current.play();
      r.ready = true;
    } catch (e) { r.failed = true; console.warn('runner model unavailable', e); }
    return r.ready;
  };

  // body look: body, hair and mouth share it; the eyes glow on their own; lash and brow cards keep theirs
  r.setLook = (k) => {
    const L = LOOKS[k] || LOOKS.rim;
    r.look = LOOKS[k] ? k : 'rim';
    if (!model) return;
    const body = L.body(), eyes = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(L.eyes), emissiveIntensity: 2.4, roughness: 0.2 });
    model.traverse((o) => {
      if (!o.isMesh || /eyelash|eyebrow/i.test(o.name)) return;
      o.material = /high-poly|^eye/i.test(o.name) ? eyes : body;
      o.castShadow = !/high-poly|^eye/i.test(o.name);
    });
  };

  r.setVisible = (v) => { r.show = v; root.visible = v && r.ready; gun.visible = v && r.ready; };

  function play(name, timeScale = 1) {
    const next = actions[name];
    if (!next) return;
    if (next !== current) { next.reset().setEffectiveWeight(1).fadeIn(0.22).play(); current.fadeOut(0.22); current = next; }
    next.timeScale = timeScale;
  }
  // lay a clip's upper body over the current pose at time t, by weight w
  const _o = new THREE.Quaternion();
  function overlay(name, t, w) {
    const o = overlays[name];
    if (!o || w <= 0.001) return;
    for (const { bone, it } of o.tracks) { _o.fromArray(it.evaluate(t)); bone.quaternion.slerp(_o, w); }
  }

  // fingers: degrees added on top of the clip. Curl turns each joint about the knuckle line, spread fans
  // the first joints apart, the thumb bends at its two outer joints and swings / twists at its root.
  const FAN = { Index: 1, Middle: 0.33, Ring: -0.33, Pinky: -1 };
  function tweakFingers(side) {
    const H = r.hold, p = side === 'Right' ? 'r' : 'l', sgn = side === 'Right' ? 1 : -1;
    const w = P(bones[side + 'Hand']), f = P(bones[side + 'HandMiddle1']).sub(w).normalize();
    const a = P(bones[side + 'HandIndex1']).sub(P(bones[side + 'HandPinky1'])); a.addScaledVector(f, -a.dot(f)).normalize();
    const n = new THREE.Vector3().crossVectors(f, a).multiplyScalar(-sgn).normalize(); // palm normal
    const curlAxis = a.clone().multiplyScalar(sgn), fanAxis = n.clone().multiplyScalar(-sgn);
    for (const name of ['Index', 'Middle', 'Ring', 'Pinky']) {
      const c = (H[p + 'Curl'] + H[p + name]) * DEG, sp = H[p + 'Spread'] * FAN[name] * DEG;
      if (sp) turn(bones[`${side}Hand${name}1`], fanAxis, sp);
      if (c) for (let i = 1; i <= 3; i++) { const b = bones[`${side}Hand${name}${i}`]; if (b) turn(b, curlAxis, c); }
    }
    const t1 = bones[side + 'HandThumb1'], t2 = bones[side + 'HandThumb2'], t3 = bones[side + 'HandThumb3'];
    if (!t3) return;
    if (H[p + 'ThumbAcross']) turn(t1, f, sgn * H[p + 'ThumbAcross'] * DEG);
    if (H[p + 'ThumbOut']) turn(t1, n, sgn * H[p + 'ThumbOut'] * DEG);
    if (H[p + 'ThumbTwist']) turn(t2, P(t3).sub(P(t2)).normalize(), H[p + 'ThumbTwist'] * DEG);
    const tb = H[p + 'ThumbBend'] * DEG;
    if (tb) { const td = P(t3).sub(P(t2)).normalize(), ax = new THREE.Vector3().crossVectors(td, n).normalize(); turn(t2, ax, tb); turn(t3, ax, tb); }
  }

  // posture on top of the clip: hip sway synced to the feet (the stance side's hip rides up, the
  // spine takes most of it back so the chest stays level), legs drawn in, chest lifted, shoulders down
  let sway = 0;
  function posture(dt) {
    const H = r.hold;
    root.updateMatrixWorld(true);
    const yaw = root.rotation.y - Math.PI;
    const fwd = V(-Math.sin(yaw), 0, -Math.cos(yaw)), right = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const moving = current === actions.walk || current === actions.run;
    const lf = P(bones.LeftFoot).y, rf = P(bones.RightFoot).y;
    // a soft curve of the feet's height difference (tanh, not a hard clamp, so it never flips like a
    // switch), eased over time so the pelvis rolls from side to side instead of snapping
    const target = moving ? Math.tanh((rf - lf) / 0.14) : 0;
    sway += (target - sway) * (1 - Math.exp(-7 * dt));
    const hs = H.hipSway * DEG * sway;
    if (hs) { turn(bones.Hips, fwd, hs); turn(bones.Spine, fwd, -hs * 0.8); }
    if (H.narrow) {
      for (const [side, sg] of [['Left', -1], ['Right', 1]]) {
        const fq = Q(bones[side + 'Foot']);
        turn(bones[side + 'UpLeg'], fwd, sg * H.narrow * DEG);
        setWorldQuat(bones[side + 'Foot'], fq);
      }
    }
    if (H.chestLift) turn(bones.Spine2, right, H.chestLift * DEG);
    if (H.shoulderDrop) { turn(bones.LeftShoulder, fwd, -H.shoulderDrop * DEG); turn(bones.RightShoulder, fwd, H.shoulderDrop * DEG); }
  }

  // Body facing is her own, apart from the camera (the free-orbit third person of open-world
  // shooters): she turns to the way she moves and keeps it when she stops, so the camera can swing
  // round to her face. Aiming or firing turns her to the camera, so shots leave where you look.
  const PISTOL_RELOAD = 1.4;
  // the pistol carry: each hand reaches for a spot below its shoulder (elbows soft and back), then turns
  // to hang thumb-forward; the gun hand's fingers tip forward so the barrel points ahead of her feet
  let carryRun = 0, carryKneel = 0;
  const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  function handFrame(S) {
    const hw = P(bones[S + 'Hand']), f = P(bones[S + 'HandMiddle1']).sub(hw).normalize();
    const a = P(bones[S + 'HandIndex1']).sub(P(bones[S + 'HandPinky1'])); a.addScaledVector(f, -a.dot(f)).normalize();
    return [f, a];
  }
  function carry(c, H, moving) {
    const fwd = V(-Math.sin(bodyYaw), 0, -Math.cos(bodyYaw)), side = V(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw)), down = V(0, -1, 0);
    root.updateMatrixWorld(true);
    const stride = moving ? P(bones.RightFoot).sub(P(bones.LeftFoot)).dot(fwd) : 0;
    for (const [S, s] of [['Right', 1], ['Left', -1]]) {
      const arm = bones[S + 'Arm'], fore = bones[S + 'ForeArm'], hand = bones[S + 'Hand'];
      const sh = P(arm), el = P(fore), wr = P(hand), len = sh.distanceTo(el) + el.distanceTo(wr);
      // running bends the elbows up; the gun arm swings less than the free one
      const drop = len * (0.93 - 0.38 * carryRun), ahead = (s > 0 ? H.pCarryFwd : 0.02) + 0.1 * carryRun;
      const swing = THREE.MathUtils.clamp(-s * stride * H.pSwing * (s > 0 ? 0.6 : 1), -0.16, 0.16);
      const goal = sh.clone().addScaledVector(down, drop).addScaledVector(side, s * (s > 0 ? H.pCarryOut : 0.02)).addScaledVector(fwd, ahead + swing);
      const lq = Q(hand);
      reach(arm, fore, hand, wr.clone().lerp(goal, c), fwd.clone().negate().addScaledVector(side, s * 0.4));
      setWorldQuat(hand, lq);
      root.updateMatrixWorld(true);
      // turn the hand: fingers down (tipped forward), thumb side forward
      const tilt = (s > 0 ? H.pCarryTilt : 8) * DEG + 0.5 * carryRun;
      const fd = down.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(fwd, Math.sin(tilt)).normalize();
      const ad = fwd.clone().addScaledVector(fd, -fwd.dot(fd)).normalize();
      const [fc, ac] = handFrame(S);
      _m1.makeBasis(fc, ac, new THREE.Vector3().crossVectors(fc, ac));
      _m2.makeBasis(fd, ad, new THREE.Vector3().crossVectors(fd, ad));
      const turnQ = new THREE.Quaternion().setFromRotationMatrix(_m2.multiply(_m1.transpose()));
      const hq = Q(hand), to = hq.clone().premultiply(turnQ);
      setWorldQuat(hand, hq.slerp(to, c));
    }
  }
  let bodyYaw = null, wasAir = false, wasAirPrev = false, jumpBaseY = null, landT = 0, aimYaw = 0, aimPitch = 0, reloadT = -1, reloadDir = null;
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  r.setGun(opts.gun || 'k7');
  r.reload = () => { reloadT = 0; };
  r.reloading = () => reloadT >= 0;

  /** ctx: { pos, vel, yaw, pitch, speed, aim (0..1), kick, flash, air, crouch } (yaw/pitch: the camera's) */
  r.update = (dt, ctx) => {
    if (!r.ready) return;
    const H = r.hold;
    const pistol = r.kind === 'pistol';
    const scale = pistol ? H.nftScale : H.gunScale;
    gun.scale.setScalar(scale);
    GRIP.set(H.gripX, H.gripY, H.gripZ); GUARD.set(H.supportX, H.supportY, H.supportZ);
    if (bodyYaw === null) bodyYaw = ctx.yaw;
    const sp = ctx.speed;
    let rate = 0, target = bodyYaw;
    if (ctx.aim > 0.05 || ctx.flash) { target = ctx.yaw; rate = ctx.flash ? 40 : 16; }
    else if (sp > 0.4) { target = Math.atan2(-ctx.vel.x, -ctx.vel.z); rate = 9; }
    bodyYaw = wrapAngle(bodyYaw + wrapAngle(target - bodyYaw) * (1 - Math.exp(-rate * dt)));
    const w = THREE.MathUtils.smoothstep(ctx.aim, 0, 1);
    r.holdWeight = w;
    root.position.copy(ctx.pos);
    // aimYaw: the extra turn that brings the barrel onto the view (the aiming clip holds it a little off)
    root.rotation.set(0, bodyYaw + Math.PI + aimYaw * w, 0);

    // base clip by state: jump in the air, crouch when crouched and still, else idle / walk / run
    const along = -Math.sin(bodyYaw) * ctx.vel.x - Math.cos(bodyYaw) * ctx.vel.z;
    const dirSign = along < -0.5 ? -1 : 1;
    const crouch = (ctx.crouch || 0) > 0.5;
    // the jump clip is take-off, top, way down, landing. In the air it plays at its own pace; only a
    // long fall reaches the way down (three quarters in), where it eases to a drift and waits for the
    // ground instead of freezing at the top. Touching down plays the rest as the landing.
    const J = actions.jump, jd = J ? J.getClip().duration : 0, fall = jd * 0.75;
    if (J && ctx.air) {
      if (!wasAir) J.reset();
      if (J.time > fall) J.time = fall;
      play('jump', THREE.MathUtils.clamp((fall - J.time) / 0.08, 0.05, 1));
      landT = 0;
    } else if (J && wasAir) { landT = jd - J.time; }
    if (!ctx.air && landT > 0) { landT -= dt; play('jump', 1); }
    else if (ctx.air) { /* jump, above */ }
    else if (crouch && sp < 0.4) play(pistol && actions.pistolCrouch ? 'pistolCrouch' : 'crouch', 1);
    else if (sp < 0.4) play(pistol && actions.pistolAim && w > 0.5 ? 'pistolAim' : 'idle', 1);
    else if (sp < 4.2) play('walk', dirSign * THREE.MathUtils.clamp(sp / 1.7, 0.7, 2));
    else play(pistol && actions.pistolRun ? 'pistolRun' : 'run', dirSign * THREE.MathUtils.clamp(sp / (pistol ? 5.6 : 5.2), 0.85, 1.8));
    wasAir = !!ctx.air;
    // three's mixer only writes a bone when its keyed value changes, so a bone a clip holds still kept
    // last frame's tweaks and they stacked until the clip moved and snapped it back. Put the clip's
    // pose back before the mixer runs.
    if (!clipPose) { clipPose = []; root.traverse((o) => { if (o.isBone) clipPose.push({ o, q: o.quaternion.clone(), p: o.position.clone() }); }); }
    for (const c of clipPose) { c.o.quaternion.copy(c.q); c.o.position.copy(c.p); }
    mixer.update(dt);
    for (const c of clipPose) { c.q.copy(c.o.quaternion); c.p.copy(c.o.position); }
    if (crouch && sp >= 0.4) root.position.y -= 0.3; // walking crouched: the walk, lowered
    // the jump clip lifts the hips itself; in the game the player's position already rises, so take the
    // clip's lift back out unless the caller wants it (ctx.clipLift: the character page stays on the floor)
    if (J && (ctx.air || landT > 0)) {
      root.updateMatrixWorld(true);
      const hy = P(bones.Hips).y;
      if (ctx.air && !wasAirPrev) jumpBaseY = hy;
      if (!ctx.clipLift && jumpBaseY !== null) root.position.y -= Math.max(0, hy - jumpBaseY);
    } else jumpBaseY = null;
    wasAirPrev = !!ctx.air;

    // aim over the upper body, then reload over that. The pistol has no walk or jump of its own: those
    // play the rifle legs with the pistol's arms laid over them
    if (pistol) {
      // the borrowed rifle clips get the pistol arms by however much of the mix they are, so a blend into
      // a pistol clip (run, kneel, aim) doesn't flash the rifle hold
      const own = ['pistolAim', 'pistolRun', 'pistolCrouch'].reduce((t, k) => t + (actions[k] ? actions[k].getEffectiveWeight() : 0), 0);
      const ow = THREE.MathUtils.clamp(1 - own, 0, 1);
      if (overlays.pistolAim && ow > 0.001) {
        overlay('pistolAim', mixer.time % overlays.pistolAim.duration, ow);
        // the pistol stance stands side-on, so on the rifle legs the arms point off to the left: turn the
        // spine until the hands are in front of her again
        root.updateMatrixWorld(true);
        const h = P(bones.RightHand).add(P(bones.LeftHand)).multiplyScalar(0.5).sub(P(bones.Spine2)).setY(0).normalize();
        const fwd = V(-Math.sin(bodyYaw), 0, -Math.cos(bodyYaw));
        const off = Math.atan2(h.z * fwd.x - h.x * fwd.z, h.dot(fwd));
        if (Math.abs(off * (1 - w) * ow) > 0.001) turn(bones.Spine, V(0, 1, 0), off * (1 - w) * ow); // aiming, the aim correction turns her
      }
    } else if (overlays.aim) overlay('aim', mixer.time % overlays.aim.duration, w);
    let rw = 0, pr = 0, prT = 0;
    // pistol reload, posed (no clip yet): the gun tips over, the left hand drops to the grip and back
    if (pistol && reloadT >= 0) {
      reloadT += dt; prT = reloadT / PISTOL_RELOAD;
      if (prT >= 1) reloadT = -1;
      else pr = THREE.MathUtils.smoothstep(prT, 0, 0.15) * (1 - THREE.MathUtils.smoothstep(prT, 0.8, 1));
    }
    if (!pistol && reloadT >= 0 && overlays.reload) {
      reloadT += dt;
      const d = overlays.reload.duration;
      if (reloadT >= d) reloadT = -1;
      else { rw = Math.max(0, Math.min(1, reloadT / 0.15, (d - reloadT) / 0.25)); overlay('reload', reloadT, rw); }
    }
    posture(dt); // after the overlays, so aiming keeps it too
    // lean the chest with the view, plus the correction that keeps the barrel on it
    root.updateMatrixWorld(true);
    const right = V(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));
    const lean = (ctx.pitch * 0.5 + aimPitch) * w;
    if (lean) { turn(bones.Spine1, right, lean); turn(bones.Spine2, right, lean); }
    // the pistol clips all aim. Not aiming, she carries it: gun hand down by her right leg, barrel
    // tipped forward, left arm hanging loose, both swinging with the stride. Reloading lifts it back up.
    if (pistol) {
      // kneeling she keeps it in both hands, muzzle low, instead (hanging by her side it goes into the thigh)
      const ease = 1 - Math.exp(-6 * dt);
      carryRun += ((sp > 4.2 ? 1 : 0) - carryRun) * ease;
      carryKneel += ((crouch && sp < 0.4 ? 1 : 0) - carryKneel) * ease;
      const c = (1 - w) * (1 - pr);
      if (c * (1 - carryKneel) > 0.001) carry(c * (1 - carryKneel), H, sp > 0.4);
      const down = (28 * pr + 40 * c * carryKneel) * DEG;
      if (down) { turn(bones.RightArm, right, -down); turn(bones.LeftArm, right, -down); }
      if (pr) turn(bones.RightHand, P(bones.RightHand).sub(P(bones.RightForeArm)).normalize(), -40 * DEG * pr);
    }
    tweakFingers('Right'); tweakFingers('Left');

    // the pistol sits in the right fist, read off the hand's own frame (the first character page's
    // hold): barrel along the knuckles' forward line, up along the pinky-to-index line
    if (pistol) {
      const hw = P(bones.RightHand), mid = P(bones.RightHandMiddle1);
      const f = mid.clone().sub(hw).normalize();
      const a = P(bones.RightHandIndex1).sub(P(bones.RightHandPinky1)); a.addScaledVector(f, -a.dot(f)).normalize();
      const n = new THREE.Vector3().crossVectors(f, a).negate().normalize();
      const fwd = f.clone().addScaledVector(a, -f.dot(a)).normalize();
      const back = fwd.clone().negate(); // the gun's +z (barrel along -z)
      gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(a, back), a, back));
      gun.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(H.pPitch * DEG, H.pYaw * DEG, H.pRoll * DEG, 'YXZ')));
      const inFist = hw.clone().lerp(mid, H.pGripAlong).addScaledVector(n, H.pGripDepth);
      gun.position.copy(inFist).sub(FIST.clone().multiplyScalar(scale).applyQuaternion(gun.quaternion))
        .addScaledVector(fwd, -(ctx.kick || 0) * 0.02);
      gun.updateMatrixWorld(true);
      // reloading: the left hand goes down to the bottom of the grip (the magazine) and comes back
      const m = THREE.MathUtils.smoothstep(prT, 0.2, 0.4) * (1 - THREE.MathUtils.smoothstep(prT, 0.65, 0.85));
      if (m > 0.001) {
        const lq = Q(bones.LeftHand), wl = P(bones.LeftHand), goal = wl.clone().lerp(gun.localToWorld(V(0, -0.17, 0.02)), m);
        reach(bones.LeftArm, bones.LeftForeArm, bones.LeftHand, goal, P(bones.LeftForeArm).sub(P(bones.LeftArm).lerp(wl, 0.5)));
        setWorldQuat(bones.LeftHand, lq);
      }
    }
    // the gun: right wrist on the grip spot, barrel toward the left wrist, rolled with the right hand
    // aiming, the stock goes in the shoulder pocket: the gun then runs from the pocket toward the left hand
    const wr = P(bones.RightHand), wl = P(bones.LeftHand);
    if (!pistol) {
    const pocket = P(bones.RightArm).lerp(P(bones.Neck).setY(P(bones.RightArm).y), 0.3); pocket.y -= 0.03;
    const toL = wl.clone().sub(wr).normalize().lerp(wl.clone().sub(pocket).normalize(), w).normalize();
    // reloading, the left hand leaves the gun: hold the barrel where it was when the reload began
    if (rw > 0) { if (!reloadDir) reloadDir = toL.clone().applyQuaternion(Q(bones.RightHand).invert()); toL.lerp(reloadDir.clone().applyQuaternion(Q(bones.RightHand)), rw).normalize(); }
    else reloadDir = null;
    const upRef = P(bones.RightHandIndex1).sub(P(bones.RightHandPinky1));
    const wy = upRef.addScaledVector(toL, -upRef.dot(toL)).normalize();
    const worldF = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(wy, toL.clone().negate()), wy, toL.clone().negate());
    // the same frame in gun space: along grip spot -> support spot, up as near the gun's up as it goes
    const span = GUARD.clone().sub(GRIP).normalize();
    const gy = V(0, 1, 0).addScaledVector(span, -span.y).normalize();
    const gunF = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(gy, span.clone().negate()), gy, span.clone().negate());
    gun.quaternion.setFromRotationMatrix(worldF.multiply(gunF.transpose()));
    gun.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(H.gunPitch * DEG, H.gunYaw * DEG, H.gunRoll * DEG, 'YXZ')));
    gun.position.copy(wr).sub(GRIP.clone().multiplyScalar(scale).applyQuaternion(gun.quaternion))
      .addScaledVector(V(0, 0, 1).applyQuaternion(gun.quaternion), (ctx.kick || 0) * 0.04);
    gun.updateMatrixWorld(true);
    // left hand onto its spot on the handguard, keeping the clip's elbow plane and hand turn
    // (not while reloading: that hand is off at the magazine)
    const pull = H.supportPull * (1 - rw);
    if (pull > 0.001) {
      const lq = Q(bones.LeftHand), spot = gun.localToWorld(GUARD.clone());
      const goal = wl.clone().lerp(spot, pull);
      const pole = P(bones.LeftForeArm).sub(P(bones.LeftArm).lerp(wl, 0.5));
      reach(bones.LeftArm, bones.LeftForeArm, bones.LeftHand, goal, pole);
      setWorldQuat(bones.LeftHand, lq);
    }
    }
    // keep the barrel on the view while aiming: nudge the body turn and chest lean by what's left over
    if (w > 0.5 && !pr) {
      const dir = V(0, 0, -1).applyQuaternion(gun.quaternion);
      const yawErr = wrapAngle(Math.atan2(-dir.x, -dir.z) - ctx.yaw);
      const pitchErr = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) - ctx.pitch;
      const k = 1 - Math.exp(-10 * dt);
      aimYaw = THREE.MathUtils.clamp(aimYaw - yawErr * k, -1.2, 1.2);
      aimPitch = THREE.MathUtils.clamp(aimPitch - pitchErr * k, -0.8, 0.8);
    }

    flash.visible = ctx.flash;
    if (flash.visible) { flash.material.rotation = Math.random() * 6.28; flash.scale.setScalar((0.14 + Math.random() * 0.08) / scale); }
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
