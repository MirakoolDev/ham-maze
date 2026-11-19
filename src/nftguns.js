// The Power-Up guns, modelled from their NFT drawings (design/nft/ham-art.js powerUpSVG): a soft pastel
// pill of a body with a rounded stock nub behind it, an angled rounded grip, a trigger loop, a thin metal
// barrel with an accent band and a glowing muzzle, a white highlight along the top, an accent line down
// each side, the small orange glass sight every HAM gun carries (a sliver of the monolith), and each
// gun's own piece: Marker's paint canister, Frost's ice crystals, Pulse's emitter ring and dial,
// Blinker's ember capsule, Snare's coils and prongs. Colours are the drawings' three-stop gradients.
// Units: metres. Barrel along -z, up +y, like the K-7 (src/gunmodel.js).
//  - the rifles (Frost dart, Blinker) keep the K-7's measurements where hands and shoulder go: its grip,
//    the stock butt about 38 cm behind it, the support hand 30 cm ahead on a sleeve round the barrel;
//  - the pistols (Marker, Pulse, Snare) are handgun size: a 2.6 cm grip her fingers wrap, a body about
//    4.2 cm wide, no stock nub (it would sit on her wrist).
import * as THREE from 'three';
import { flashTexture } from './gunmodel.js';

export const NFT_GUNS = {
  marker: { name: 'Marker', kind: 'pistol', body: ['#fff6f8', '#f7c3d3', '#cf8aa3'], metal: ['#fdf3f6', '#ead6e2', '#b89cb3'], grip: ['#fff0f5', '#f3a9c2', '#c46f8f'], accent: '#ff4f97', glow: '#ff7db4', barrel: 0.035 },
  frost: { name: 'Frost dart', kind: 'rifle', body: ['#ffffff', '#dcf1ff', '#94bfdf'], metal: ['#f4fbff', '#c6e2f4', '#7fa7c6'], grip: ['#eef8ff', '#a9d4f2', '#6d9cc2'], accent: '#5fd0ff', glow: '#9fe6ff', barrel: 0.42 },
  pulse: { name: 'Pulse', kind: 'pistol', body: ['#fbf8ff', '#ddd2fb', '#9e90d6'], metal: ['#f6f3ff', '#d4ccf2', '#8f86c0'], grip: ['#f4efff', '#bfb0f0', '#7d6fbd'], accent: '#b58cff', glow: '#cdb0ff', barrel: 0.06 },
  blinker: { name: 'Blinker', kind: 'rifle', body: ['#fffaf4', '#f6dcd2', '#c6a1b4'], metal: ['#fffaf0', '#f1dcc4', '#c49a7c'], grip: ['#f3f0ff', '#c9c3ef', '#8b84bd'], accent: '#ff7a2e', glow: '#ff9a5c', barrel: 0.26, pearl: true },
  snare: { name: 'Snare', kind: 'pistol', body: ['#f4fffb', '#bfeadf', '#6fae9f'], metal: ['#f1fffa', '#cdeee4', '#7bb3a5'], grip: ['#effff9', '#9fdccc', '#5c9a8b'], accent: '#7dffe0', glow: '#9ffff0', barrel: 0.045 },
};

/** Extrude a side profile [[f, y], ...] (f = forward) to thickness t across x, with rounded edges. */
function side(pts, t, bevel = 0.004) {
  const s = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, t - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, -(t - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // forward -> -z
  return g;
}
/** A pill along z: radius r (height), from z0 to z1, squeezed across to width w. */
function pill(r, z0, z1, y, w = 2 * r) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, Math.abs(z1 - z0) - 2 * r), 8, 24);
  g.rotateX(Math.PI / 2); g.scale(w / (2 * r), 1, 1); g.translate(0, y, (z0 + z1) / 2);
  return g;
}
/** A cylinder along z: radius r, from z0 to z1, at height y. */
function tube(r, z0, z1, y, seg = 28, r2 = r) {
  const g = new THREE.CylinderGeometry(r, r2, Math.abs(z1 - z0), seg); g.rotateX(Math.PI / 2); g.translate(0, y, (z0 + z1) / 2);
  return g;
}
/** A round tube along a path of points (trigger loops, prongs). */
const bend = (pts, r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, r, 10, false);
/** A ring: standing across the gun (facing x), or facing forward; centre (y, z). */
function loop(R, r, y, z, faceForward = false) {
  const g = new THREE.TorusGeometry(R, r, 12, 36);
  if (!faceForward) g.rotateY(Math.PI / 2);
  g.translate(0, y, z);
  return g;
}
/** Paint the drawings' vertical gradient (top, 42 %, bottom) into the vertex colours. */
function gradient(geo, stops) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox, c = stops.map((h) => new THREE.Color(h)), pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = 1 - (pos.getY(i) - min.y) / Math.max(1e-6, max.y - min.y);
    if (t < 0.42) tmp.copy(c[0]).lerp(c[1], t / 0.42); else tmp.copy(c[1]).lerp(c[2], (t - 0.42) / 0.58);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Build one gun. Returns { group, flash, kind, muzzle, fist, guard } (points in the group's space).
 *  fist: a pistol's grip middle, where her closed hand sits. guard: a rifle's support wrist spot (as HOLD). */
export function buildNftGun(id) {
  const g = NFT_GUNS[id], rifle = g.kind === 'rifle';
  const group = new THREE.Group();
  const paint = (extra = {}) => new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color(g.glow), ...extra });
  const M = {
    body: paint(g.pearl ? { iridescence: 0.9, iridescenceIOR: 1.6, sheen: 1 } : {}),
    metal: paint({ roughness: 0.26, metalness: 0.15 }),
    grip: paint({ roughness: 0.55, clearcoat: 0.3 }),
    accent: new THREE.MeshPhysicalMaterial({ color: g.accent, emissive: g.accent, emissiveIntensity: 0.35, roughness: 0.3, clearcoat: 1 }),
    glow: new THREE.MeshStandardMaterial({ color: g.glow, emissive: g.glow, emissiveIntensity: 2.2, roughness: 0.2 }),
    white: new THREE.MeshPhysicalMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.2, clearcoat: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, transmission: 0.92, thickness: 0.01, ior: 1.4, clearcoat: 1, transparent: true, opacity: 0.55 }),
    ice: new THREE.MeshPhysicalMaterial({ color: '#dff6ff', emissive: g.accent, emissiveIntensity: 0.25, roughness: 0.08, transmission: 0.55, thickness: 0.02, ior: 1.3, clearcoat: 1, flatShading: true }),
    seam: new THREE.MeshStandardMaterial({ color: new THREE.Color(g.body[2]).multiplyScalar(0.8), roughness: 0.6 }),
    sight: new THREE.MeshPhysicalMaterial({ color: '#ff8a3d', emissive: '#ff6a1f', emissiveIntensity: 0.9, roughness: 0.05, transmission: 0.5, thickness: 0.01, transparent: true, opacity: 0.85 }),
  };
  const add = (geo, mat, stops) => { if (stops) gradient(geo, stops); const m = new THREE.Mesh(geo, M[mat]); m.castShadow = true; group.add(m); return m; };

  // ---- layout: rifles on the K-7's numbers, pistols at handgun size ----
  const Y = rifle ? 0.02 : 0.022;                 // body axis height (the grip hangs below it)
  const R = rifle ? 0.037 : 0.029;                // body radius (height / 2)
  const W = rifle ? 0.058 : 0.042;                // body width
  const back = rifle ? 0.17 : 0.07, front = rifle ? -0.2 : -0.115;
  const bR = rifle ? 0.017 : 0.0125;              // barrel radius
  const bEnd = front - g.barrel - (rifle ? 0 : 0.01);

  // body: the pill, two seam rings, the white highlight along the top, accent lines down both sides
  add(pill(R, back, front, Y, W), 'body', g.body);
  for (const z of [back - 0.35 * (back - front), back - 0.72 * (back - front)]) {
    const s = new THREE.TorusGeometry(R * 0.995, 0.0012, 6, 40); s.scale(W / (2 * R), 1, 1); s.translate(0, Y, z); add(s, 'seam');
  }
  add(pill(0.0035, back - 0.025, front + 0.035, Y + R - 0.004, 0.012 * (rifle ? 1.4 : 1)), 'white');
  for (const s of [-1, 1]) { const l = pill(0.0016, back - 0.03, front + 0.02, Y - R * 0.2, 0.003); l.translate(s * W / 2 * 0.985, 0, 0); add(l, 'accent'); }
  // screws on each side over the grip
  for (const s of [-1, 1]) for (const z of [back - 0.05, rifle ? 0.02 : 0.0]) {
    const c = new THREE.CylinderGeometry(0.0035, 0.0035, 0.002, 14); c.rotateZ(Math.PI / 2); c.translate(s * W / 2 * 0.93, Y - R * 0.45, z); add(c, 'metal', g.metal);
  }

  // stock nub (rifles: back to the K-7's butt, where her shoulder goes)
  if (rifle) {
    add(pill(0.027, 0.39, back - 0.06, Y - 0.006, 0.044), 'grip', g.grip);
    add(pill(0.0285, 0.394, 0.372, Y - 0.006, 0.046), 'metal', g.metal); // butt cap
  }

  // grip: the K-7's angled profile (rifles) or a handgun's (pistols), rounded, with a darker base
  if (rifle) {
    add(side([[-0.056, Y - R * 0.5], [-0.01, Y - R * 0.5], [-0.022, -0.06], [-0.031, -0.1], [-0.038, -0.148], [-0.06, -0.156], [-0.083, -0.15], [-0.078, -0.1], [-0.07, -0.06]], 0.026, 0.006), 'grip', g.grip);
    add(side([[-0.036, -0.138], [-0.038, -0.148], [-0.06, -0.156], [-0.083, -0.15], [-0.081, -0.14]], 0.028, 0.004), 'metal', g.metal);
  } else {
    const pg = new THREE.Shape(); pg.moveTo(-0.054, Y - R * 0.5); pg.lineTo(0.0, Y - R * 0.5);
    pg.bezierCurveTo(-0.006, -0.035, -0.014, -0.07, -0.026, -0.094); pg.quadraticCurveTo(-0.034, -0.11, -0.052, -0.108);
    pg.quadraticCurveTo(-0.07, -0.106, -0.068, -0.088); pg.bezierCurveTo(-0.064, -0.06, -0.058, -0.03, -0.054, Y - R * 0.5);
    add(side(pg.getPoints(14).map((p) => [p.x, p.y]), 0.026, 0.007), 'grip', g.grip);
    add(side([[-0.027, -0.092], [-0.033, -0.104], [-0.052, -0.11], [-0.066, -0.104], [-0.067, -0.094]], 0.028, 0.004), 'metal', g.metal);
  }
  // trigger loop and trigger
  const gz = rifle ? -0.012 : -0.004, gy = Y - R * 0.6;
  add(bend([[0, gy, gz + 0.002], [0, gy - 0.03, gz - 0.002], [0, gy - 0.036, gz - 0.03], [0, gy - 0.028, gz - 0.05], [0, gy, gz - 0.054]], 0.0032), 'metal', g.metal);
  add(bend([[0, gy, gz - 0.026], [0, gy - 0.012, gz - 0.024], [0, gy - 0.02, gz - 0.018]], 0.0028), 'accent');

  // barrel: metal tube out of the front, accent band near the end, glowing muzzle
  add(tube(bR, front + 0.03, bEnd, Y), 'metal', g.metal);
  add(tube(bR + 0.006, bEnd + 0.035, bEnd + 0.018, Y), 'accent');
  add(tube(bR + 0.0065, bEnd + 0.03, bEnd + 0.028, Y), 'white');
  add(tube(bR * 0.55, bEnd + 0.001, bEnd - 0.002, Y, 20), 'glow');
  if (rifle) {
    add(tube(bR + 0.005, front + 0.01, front - 0.035, Y), 'metal', g.metal); // barrel collar
    // a ribbed sleeve where her support hand holds the barrel
    add(tube(bR + 0.003, -0.24, -0.36, Y), 'grip', g.grip);
    for (let i = 0; i < 5; i++) add(loop(bR + 0.003, 0.0018, Y, -0.255 - i * 0.022, true), 'grip', g.grip);
  }

  // the monolith sight on top, toward the front
  const sz = front + (rifle ? 0.035 : 0.03);
  add(new THREE.BoxGeometry(0.009, rifle ? 0.036 : 0.026, 0.011).translate(0, Y + R + (rifle ? 0.014 : 0.009), sz), 'sight');
  add(new THREE.BoxGeometry(0.011, 0.004, 0.014).translate(0, Y + R - 0.002, sz), 'metal', g.metal);

  // ---- each gun's own piece ----
  let muzzleZ = bEnd - 0.004;
  if (id === 'marker') {
    // wide paint nozzle, and a glass paint canister on top, half full
    add(tube(0.017, bEnd + 0.02, bEnd - 0.004, Y, 28, 0.019), 'body', g.body);
    add(tube(0.011, bEnd - 0.004, bEnd - 0.006, Y, 20), 'glow');
    const cy = Y + R + 0.016, cz0 = back - 0.012, cz1 = sz + 0.012;
    add(pill(0.0145, cz0, cz1, cy), 'glass');
    add(pill(0.0105, cz0 - 0.004, cz1 + 0.004, cy, 0.02).scale(1, 0.62, 1).translate(0, -0.003, 0), 'accent');
    for (const z of [cz0 - 0.008, cz1 + 0.008]) add(new THREE.BoxGeometry(0.008, 0.012, 0.006).translate(0, Y + R + 0.002, z), 'metal', g.metal);
    muzzleZ = bEnd - 0.008;
  } else if (id === 'frost') {
    // three ice crystals standing on the top, glowing from inside
    for (let i = 0; i < 3; i++) {
      const z = 0.1 - i * 0.1;
      const o = new THREE.OctahedronGeometry(0.019, 0); o.scale(0.7, 1.35, 0.9); o.translate(0, Y + R + 0.016, z); add(o, 'ice');
      const core = new THREE.OctahedronGeometry(0.008, 0); core.scale(0.7, 1.35, 0.9); core.translate(0, Y + R + 0.012, z); add(core, 'glow');
      add(new THREE.CylinderGeometry(0.008, 0.01, 0.006, 12).translate(0, Y + R - 0.001, z), 'metal', g.metal);
    }
  } else if (id === 'pulse') {
    // the emitter ring at the muzzle on three spokes, and a dial on top at the back
    add(loop(0.034, 0.0045, Y, bEnd - 0.012, true), 'metal', g.metal);
    add(loop(0.034, 0.0018, Y, bEnd - 0.0175, true), 'glow');
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.PI / 2, s = new THREE.CylinderGeometry(0.0018, 0.0018, 0.03, 8);
      s.translate(0, 0.019, 0); s.rotateZ(a); s.translate(0, Y, bEnd - 0.012); add(s, 'metal', g.metal);
    }
    const dz = back - 0.045, dy = Y + R + 0.012;
    for (const sx of [-1, 1]) {
      const d = new THREE.CylinderGeometry(0.015, 0.015, 0.006, 32); d.rotateZ(Math.PI / 2); d.translate(sx * 0.004, dy, dz); add(d, 'metal', g.metal);
      const face = new THREE.CircleGeometry(0.012, 32); face.rotateY(sx * Math.PI / 2); face.translate(sx * 0.0072, dy, dz); add(face, 'white');
      const n = new THREE.BoxGeometry(0.001, 0.0022, 0.011); n.translate(0, 0, -0.005); n.rotateX(-0.8); n.translate(sx * 0.0078, dy, dz); add(n, 'accent');
    }
    add(new THREE.BoxGeometry(0.008, 0.01, 0.012).translate(0, Y + R + 0.001, dz), 'metal', g.metal);
    muzzleZ = bEnd - 0.012;
  } else if (id === 'blinker') {
    // a glass capsule on top with the ember floating in it, banded at both ends
    const cy = Y + R + 0.018, cz0 = 0.12, cz1 = -0.13;
    add(pill(0.014, cz0, cz1, cy), 'glass');
    add(pill(0.008, 0.02, -0.03, cy, 0.012), 'glow');
    for (const z of [cz0 - 0.03, cz1 + 0.03]) add(tube(0.0152, z + 0.004, z - 0.004, cy), 'white');
    for (const z of [cz0 - 0.03, cz1 + 0.03]) add(new THREE.BoxGeometry(0.008, 0.014, 0.008).translate(0, Y + R + 0.002, z), 'metal', g.metal);
  } else if (id === 'snare') {
    // three prongs curling out of the muzzle, and four coils along the top
    for (const k of [-1, 0, 1]) add(bend([[0, Y + k * 0.008, bEnd + 0.004], [0, Y + k * 0.016, bEnd - 0.02], [0, Y + k * 0.026, bEnd - 0.03]], 0.0032), 'metal', g.metal);
    for (const k of [-1, 0, 1]) add(new THREE.SphereGeometry(0.0045, 14, 10).translate(0, Y + k * 0.026, bEnd - 0.031), 'glow');
    for (let i = 0; i < 4; i++) add(loop(0.011, 0.0028, Y + R + 0.009, back - 0.02 - i * 0.034), 'metal', g.metal);
    muzzleZ = bEnd - 0.034;
  }

  const muzzle = new THREE.Vector3(0, Y, muzzleZ);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: g.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.position.copy(muzzle); flash.visible = false; group.add(flash);
  return {
    group, flash, kind: g.kind, muzzle,
    fist: rifle ? null : new THREE.Vector3(0, -0.05, 0.035),
    // the support wrist sits under the barrel sleeve, 30 cm out, as under the K-7's handguard
    guard: rifle ? new THREE.Vector3(-0.02, Y - bR - 0.024, -0.3) : null,
  };
}
