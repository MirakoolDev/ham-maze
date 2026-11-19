// The Power-Up guns from the NFT art (design/nft/ham-art.js GUNS) as small 3D props for the runner,
// ported from the first character page (design/character/legacy.html). Each comes back wrapped so the
// barrel runs along -z like the K-7 (src/gunmodel.js), with the grip at the origin.
// kind: 'pistol' guns use the pistol clips (one hand on the grip, the other wrapped round it);
// 'rifle' guns use the rifle set and need a spot for the support hand under the barrel.
import * as THREE from 'three';

export const NFT_GUNS = {
  marker: { name: 'Marker', kind: 'pistol', body: '#fff6f8', mid: '#f7c3d3', accent: '#ff4f97', glow: '#ff7db4', len: 0.22, bore: 0.03 },
  frost: { name: 'Frost dart', kind: 'rifle', body: '#ffffff', mid: '#dcf1ff', accent: '#5fd0ff', glow: '#9fe6ff', len: 0.46, bore: 0.012 },
  pulse: { name: 'Pulse', kind: 'pistol', body: '#f6f1ff', mid: '#d9c8ff', accent: '#b58cff', glow: '#cdb0ff', len: 0.26, bore: 0.04, core: true },
  blinker: { name: 'Blinker', kind: 'rifle', body: '#fff4ec', mid: '#ffd0b3', accent: '#ff7a2e', glow: '#ff9a5c', len: 0.32, bore: 0.022, pearl: true },
  snare: { name: 'Snare', kind: 'pistol', body: '#effffb', mid: '#c4f5ea', accent: '#7dffe0', glow: '#9ffff0', len: 0.24, bore: 0.05, core: true },
};

function roundedBox(w, h, d, r) {
  const s = new THREE.Shape();
  const x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y); s.lineTo(w / 2, y);
  s.quadraticCurveTo(w / 2, h / 2, x, h / 2); s.lineTo(-x, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y);
  s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -d / 2);
  return geo;
}

/** Build one gun. Returns { group, flash, kind, muzzle, grip, guard } with points in the group's space. */
export function buildNftGun(id) {
  const g = NFT_GUNS[id];
  const group = new THREE.Group(), inner = new THREE.Group();
  inner.rotation.y = Math.PI; // built barrel along +z; turned to run along -z like the K-7
  group.add(inner);
  const shell = new THREE.MeshPhysicalMaterial({ color: g.body, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, sheen: g.pearl ? 1 : 0, sheenColor: new THREE.Color(g.glow), iridescence: g.pearl ? 0.8 : 0 });
  const mid = new THREE.MeshPhysicalMaterial({ color: g.mid, roughness: 0.4, clearcoat: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: g.glow, emissive: g.accent, emissiveIntensity: 1.6, roughness: 0.1, transmission: 0.4, thickness: 0.2 });
  const add = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; inner.add(m); return m; };
  const L = g.len, R = (w, h, d, r = 0.012) => roundedBox(w, h, d, r);
  add(R(0.05, 0.07, L * 0.62), shell, 0, 0.055, L * 0.18);                                                    // receiver
  add(new THREE.CylinderGeometry(g.bore + 0.008, g.bore + 0.01, L * 0.5, 24), mid, 0, 0.07, L * 0.62, Math.PI / 2); // barrel
  add(new THREE.CylinderGeometry(g.bore * 0.7, g.bore * 0.7, 0.012, 20), glass, 0, 0.07, L * 0.87 + 0.002, Math.PI / 2); // muzzle glow
  add(R(0.038, 0.1, 0.05, 0.01), mid, 0, -0.01, -0.005, -0.25);                                               // grip
  add(R(0.012, 0.016, L * 0.5, 0.004), glass, 0, 0.093, L * 0.16);                                            // glowing spine
  if (L > 0.3) add(R(0.044, 0.06, 0.12, 0.012), shell, 0, 0.05, -L * 0.2);                                     // stock
  if (g.core) add(new THREE.SphereGeometry(0.035, 24, 16), glass, 0, 0.05, L * 0.3);                           // core
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: g.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.position.set(0, 0.07, -(L * 0.9)); flash.visible = false; group.add(flash);
  return {
    group, flash, kind: g.kind,
    muzzle: new THREE.Vector3(0, 0.07, -L * 0.88),
    // runner spots (gun space): the right wrist sits behind and below the grip; the support wrist under the barrel
    grip: new THREE.Vector3(0, -0.075, 0.075),
    guard: new THREE.Vector3(-0.02, -0.02, -L * 0.6),
  };
}
