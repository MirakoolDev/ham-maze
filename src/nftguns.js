// The Power-Up guns from the NFT art (design/nft/ham-art.js GUNS) as 3D props for the runner, in their
// colours, sized to her hand. Units: metres. Barrel along -z, up +y, like the K-7 (src/gunmodel.js).
//  - the rifles (Frost dart, Blinker) are laid out on the K-7's own measurements: pistol grip, handguard and
//    stock in the same places, so the hold tuned for the K-7 (HOLD wrist spots) fits them too;
//  - the pistols (Marker, Pulse, Snare) are real handgun size: a grip about 2.6 x 4.6 cm her fingers wrap,
//    a slide about 3 cm wide, 17 to 22 cm long.
import * as THREE from 'three';
import { flashTexture } from './gunmodel.js';

export const NFT_GUNS = {
  marker: { name: 'Marker', kind: 'pistol', body: '#fff6f8', mid: '#f7c3d3', accent: '#ff4f97', glow: '#ff7db4', len: 0.19, muzzle: 0.019 },
  frost: { name: 'Frost dart', kind: 'rifle', body: '#ffffff', mid: '#dcf1ff', accent: '#5fd0ff', glow: '#9fe6ff', reach: 0.6 },
  pulse: { name: 'Pulse', kind: 'pistol', body: '#f6f1ff', mid: '#d9c8ff', accent: '#b58cff', glow: '#cdb0ff', len: 0.21, muzzle: 0.017, core: true },
  blinker: { name: 'Blinker', kind: 'rifle', body: '#fff4ec', mid: '#ffd0b3', accent: '#ff7a2e', glow: '#ff9a5c', reach: 0.47, pearl: true },
  snare: { name: 'Snare', kind: 'pistol', body: '#effffb', mid: '#c4f5ea', accent: '#7dffe0', glow: '#9ffff0', len: 0.2, muzzle: 0.026, core: true },
};

/** Extrude a side profile [[f, y], ...] (f = forward) to thickness t across x, rounded edges. */
function side(pts, t, bevel = 0.003) {
  const s = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, t - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -(t - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // forward -> -z
  return g;
}
/** Rounded rectangle profile from f0..f1, y0..y1. */
function rr(f0, y0, f1, y1, r, seg = 3) {
  const p = [];
  const arc = (cf, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); p.push([cf + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(f1 - r, y0 + r, -Math.PI / 2); arc(f1 - r, y1 - r, 0); arc(f0 + r, y1 - r, Math.PI / 2); arc(f0 + r, y0 + r, Math.PI);
  return p;
}
/** Cylinder along the bore: radius r, from f0 to f1, at height y. */
const tube = (r, f0, f1, y, seg = 24) => { const g = new THREE.CylinderGeometry(r, r, f1 - f0, seg); g.rotateX(Math.PI / 2); g.translate(0, y, -(f0 + f1) / 2); return g; };

/** Build one gun. Returns { group, flash, kind, muzzle, fist } (points in the group's space).
 *  fist: for a pistol, the middle of the grip, where her closed hand sits. */
export function buildNftGun(id) {
  const g = NFT_GUNS[id];
  const group = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({ color: g.body, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.15, sheen: g.pearl ? 1 : 0, sheenColor: new THREE.Color(g.glow), iridescence: g.pearl ? 0.8 : 0 });
  const mid = new THREE.MeshPhysicalMaterial({ color: g.mid, roughness: 0.42, clearcoat: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: g.glow, emissive: g.accent, emissiveIntensity: 1.4, roughness: 0.1, transmission: 0.4, thickness: 0.2 });
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; group.add(m); return m; };
  let muzzle, fist = null;

  if (g.kind === 'rifle') {
    // the K-7's layout: bore at y 0.025, receiver f -0.1..0.165, pistol grip just behind f 0, handguard
    // from 0.168 to the reach, stock back to f -0.38. Handguard 4.4 cm wide like the slim K-7's.
    const BORE = 0.025, end = g.reach;
    add(side(rr(-0.1, -0.03, 0.17, 0.058, 0.014), 0.05), shell);                                   // receiver
    add(side([[-0.052, -0.035], [-0.014, -0.035], [-0.022, -0.06], [-0.031, -0.1], [-0.038, -0.148], [-0.06, -0.156], [-0.083, -0.15], [-0.078, -0.1], [-0.07, -0.06]], 0.026), mid); // grip, the K-7's
    add(side([[-0.026, -0.03], [0.014, -0.03], [0.012, -0.07], [-0.026, -0.07]], 0.012, 0.002), mid); // trigger guard block
    add(side(rr(0.168, -0.008, end, 0.057, 0.016), 0.044), shell);                                  // handguard
    add(side(rr(0.2, 0.002, end - 0.03, 0.02, 0.006), 0.046, 0.002), glass);                        // glowing slot down each side
    add(tube(0.0105, end, end + 0.06, BORE), mid);                                                 // barrel out the front
    add(tube(0.017, end + 0.04, end + 0.07, BORE), mid);                                           // muzzle
    add(tube(0.011, end + 0.069, end + 0.073, BORE, 20), glass);                                   // muzzle glow
    add(side([[-0.1, 0.05], [-0.33, 0.04], [-0.37, 0.034], [-0.375, -0.08], [-0.34, -0.088], [-0.24, -0.05], [-0.1, -0.026]], 0.04), shell); // stock
    add(side(rr(-0.39, -0.09, -0.365, 0.04, 0.008), 0.044, 0.003), mid);                           // butt pad
    add(side(rr(-0.08, 0.058, end - 0.02, 0.072, 0.006), 0.014, 0.002), glass);                    // glowing spine on top
    if (g.pearl) add(new THREE.SphereGeometry(0.02, 24, 16).translate(0, 0.072, -0.04), glass);    // charge bead
    muzzle = new THREE.Vector3(0, BORE, -(end + 0.08));
  } else {
    // a handgun: slide on top, grip angled back 15 degrees under the rear, barrel shroud out the front
    const L = g.len, rear = -0.055, front = rear + L, BORE = 0.024;
    add(side(rr(rear, 0.004, front, 0.042, 0.01), 0.029), shell);                                  // slide
    add(side(rr(rear + 0.01, -0.016, front - 0.03, 0.006, 0.006), 0.027), mid);                    // frame under the slide
    add(side([[-0.05, -0.012], [0.0, -0.012], [-0.012, -0.06], [-0.022, -0.105], [-0.068, -0.108], [-0.06, -0.06]], 0.026), mid); // grip, 2.6 cm wide
    add(side([[0.004, -0.016], [0.046, -0.016], [0.046, -0.022], [0.014, -0.05], [0.003, -0.05], [0.004, -0.04], [0.008, -0.044], [0.036, -0.022], [0.004, -0.022]], 0.01, 0.002), mid); // trigger guard
    add(tube(g.muzzle, front - 0.004, front + 0.03, BORE), mid);                                   // muzzle shroud
    add(tube(g.muzzle * 0.7, front + 0.029, front + 0.033, BORE, 20), glass);                      // muzzle glow
    add(side(rr(rear + 0.02, 0.04, front - 0.02, 0.05, 0.004), 0.01, 0.002), glass);               // glowing spine
    if (g.core) add(new THREE.SphereGeometry(0.017, 24, 16).translate(0, 0.046, -(rear + 0.035)), glass); // core at the back of the slide
    muzzle = new THREE.Vector3(0, BORE, -(front + 0.035));
    fist = new THREE.Vector3(0, -0.05, 0.035);
  }
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), color: g.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.position.copy(muzzle); flash.visible = false; group.add(flash);
  return { group, flash, kind: g.kind, muzzle, fist };
}
