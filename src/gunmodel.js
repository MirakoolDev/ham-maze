// K-7 carbine, built from side-profile extrusions with bevelled edges (so every edge catches light),
// merged per material. Units: metres. Forward is -Z, up is +Y, bore axis at y = BORE.
// Palette (HAM, matches the sentry): cream polymer, lavender-slate metal, dusty-blue grips and mag, pink accents.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const BORE = 0.025;
export const SIGHT_Y = 0.088;

/** Extrude a side profile. pts: [[f, y], ...] with f = distance forward. t = thickness (x). */
function side(pts, t, { bevel = 0.0022, holes = [], curve = null } = {}) {
  const s = curve || new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([f, y]) => new THREE.Vector2(f, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, t - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -(t - bevel * 2) / 2);
  g.rotateY(Math.PI / 2); // shape x (forward) -> -z, extrusion -> x
  return g;
}
/** Rounded rectangle as a point list (for profiles and holes). */
function rr(f0, y0, f1, y1, r, seg = 3) {
  const p = [];
  const arc = (cf, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); p.push([cf + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  arc(f1 - r, y0 + r, -Math.PI / 2); arc(f1 - r, y1 - r, 0); arc(f0 + r, y1 - r, Math.PI / 2); arc(f0 + r, y0 + r, Math.PI);
  return p;
}
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const box = (w, h, l, x, y, f, rx = 0) => { const g = new THREE.BoxGeometry(w, h, l); if (rx) g.rotateX(rx); g.translate(x, y, -f); return g; };
const cyl = (r, l, f, y = BORE, seg = 20, x = 0) => { const g = new THREE.CylinderGeometry(r, r, l, seg); g.rotateX(Math.PI / 2); g.translate(x, y, -f); return g; };

function grainTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), img = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 150 + Math.random() * 70; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); return t;
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,245,248,1)'); grd.addColorStop(0.18, 'rgba(255,70,120,1)'); grd.addColorStop(0.45, 'rgba(255,40,100,.35)'); grd.addColorStop(1, 'rgba(255,40,100,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.translate(64, 64);
  for (let i = 0; i < 7; i++) {
    g.rotate((Math.PI * 2) / 7 + Math.random() * 0.3);
    const grd = g.createLinearGradient(0, 0, 60, 0); grd.addColorStop(0, 'rgba(255,240,236,1)'); grd.addColorStop(1, 'rgba(255,130,165,0)');
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, -6); g.lineTo(60, 0); g.lineTo(0, 6); g.fill();
  }
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 30); r.addColorStop(0, 'rgba(255,252,248,1)'); r.addColorStop(1, 'rgba(255,150,180,0)');
  g.fillStyle = r; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildGun() {
  const grain = grainTexture();
  const M = {
    metal: new THREE.MeshStandardMaterial({ color: srgb(0.36, 0.34, 0.45), metalness: 0.35, roughness: 0.42, roughnessMap: grain }),
    tan: new THREE.MeshStandardMaterial({ color: srgb(0.95, 0.91, 0.85).multiplyScalar(0.82), metalness: 0, roughness: 0.66, roughnessMap: grain }),
    rubber: new THREE.MeshStandardMaterial({ color: srgb(0.6, 0.72, 0.95).multiplyScalar(0.8), metalness: 0, roughness: 0.78 }),
    dark: new THREE.MeshStandardMaterial({ color: srgb(0.16, 0.15, 0.21), metalness: 0.3, roughness: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: srgb(1, 0.56, 0.65), metalness: 0.05, roughness: 0.4, emissive: srgb(1, 0.4, 0.52), emissiveIntensity: 0.12 }),
  };
  const parts = { metal: [], tan: [], rubber: [], dark: [], accent: [] };
  const add = (mat, g) => parts[mat].push(g.index ? g.toNonIndexed() : g);

  // ---- upper receiver + top rail ----
  add('metal', side([[-0.1, 0], [0.165, 0], [0.165, 0.052], [0.15, 0.058], [-0.085, 0.058], [-0.1, 0.046]], 0.05));
  add('dark', box(0.003, 0.016, 0.055, 0.0255, 0.03, 0.05)); // ejection port
  add('metal', box(0.012, 0.012, 0.012, 0.028, 0.032, -0.055)); // forward assist
  add('metal', box(0.022, 0.006, 0.52, 0, 0.061, 0.165)); // rail spine (f -0.095 .. 0.425)
  for (let f = -0.085; f <= 0.42; f += 0.0105) add('metal', box(0.025, 0.0045, 0.0052, 0, 0.0665, f)); // rail teeth
  add('metal', box(0.03, 0.008, 0.024, 0, 0.05, -0.098)); // charging handle

  // ---- lower receiver, magwell, trigger guard, trigger ----
  add('metal', side([[-0.09, 0.001], [0.15, 0.001], [0.15, -0.012], [0.104, -0.03], [0.098, -0.078], [0.02, -0.078], [0.018, -0.043], [-0.052, -0.043], [-0.09, -0.02]], 0.047));
  add('metal', side(rr(-0.034, -0.072, 0.02, -0.04, 0.008), 0.012, { bevel: 0.0015, holes: [rr(-0.026, -0.066, 0.012, -0.044, 0.005)] }));
  add('accent', box(0.006, 0.02, 0.006, 0, -0.052, -0.004, 0.25)); // trigger blade
  add('metal', box(0.05, 0.006, 0.016, 0, -0.003, 0.08)); // receiver pins band
  // left flank detail (the side you see at the hip): panel grooves, stripe, bolt catch, selector, mag release, pins
  add('dark', box(0.0515, 0.0025, 0.2, 0, 0.04, 0.03)); // upper groove
  add('dark', box(0.0515, 0.0025, 0.13, 0, 0.014, 0.06)); // upper lower groove
  add('accent', box(0.0512, 0.006, 0.04, 0, 0.026, -0.05)); // stripe
  add('metal', box(0.006, 0.02, 0.012, -0.025, -0.022, 0.012)); // bolt catch
  add('metal', box(0.006, 0.007, 0.026, -0.0245, -0.03, -0.034, -0.3)); // selector lever
  add('dark', box(0.0495, 0.012, 0.012, 0, -0.024, 0.045)); // mag release
  for (const f of [-0.07, 0.1]) { const g = new THREE.CylinderGeometry(0.0045, 0.0045, 0.0495, 10); g.rotateZ(Math.PI / 2); g.translate(0, -0.012, -f); add('dark', g); } // pins

  // ---- pistol grip (angled, with a finger swell) ----
  add('tan', side([[-0.052, -0.035], [-0.014, -0.035], [-0.022, -0.06], [-0.031, -0.1], [-0.038, -0.148], [-0.06, -0.156], [-0.083, -0.15], [-0.078, -0.1], [-0.07, -0.06]], 0.034, { bevel: 0.004 }));
  add('rubber', side([[-0.031, -0.1], [-0.038, -0.148], [-0.06, -0.156], [-0.083, -0.15], [-0.078, -0.1]], 0.036, { bevel: 0.002 }));

  // ---- handguard with slots (barrel shows through) ----
  const slots = [];
  for (let i = 0; i < 5; i++) slots.push(rr(0.192 + i * 0.044, 0.016, 0.222 + i * 0.044, 0.028, 0.005));
  for (let i = 0; i < 4; i++) slots.push(rr(0.214 + i * 0.044, -0.012, 0.244 + i * 0.044, 0.0, 0.005));
  add('tan', side(rr(0.168, -0.03, 0.43, 0.057, 0.012), 0.062, { bevel: 0.003, holes: slots }));
  add('metal', cyl(0.033, 0.012, 0.432, 0.014, 24)); // end cap
  add('accent', cyl(0.0335, 0.004, 0.441, 0.014, 24));

  // ---- barrel, gas block, muzzle brake ----
  add('metal', cyl(0.0105, 0.48, 0.34));
  add('metal', box(0.026, 0.03, 0.022, 0, BORE + 0.004, 0.405));
  add('metal', cyl(0.0165, 0.064, 0.6, BORE, 16));
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) add('dark', box(0.004, 0.012, 0.009, s * 0.0155, BORE, 0.585 + i * 0.015));
  add('metal', box(0.007, 0.03, 0.012, 0, 0.083, 0.405)); // folding front sight

  // ---- stock: skeleton profile, buffer tube inside, rubber butt pad ----
  add('metal', cyl(0.0148, 0.21, -0.2, 0.02, 20));
  add('tan', side([[-0.1, 0.046], [-0.33, 0.036], [-0.36, 0.03], [-0.365, -0.075], [-0.33, -0.086], [-0.24, -0.046], [-0.1, -0.022]], 0.042,
    { bevel: 0.004, holes: [[[-0.17, 0.024], [-0.298, 0.019], [-0.298, -0.036], [-0.25, -0.036], [-0.17, -0.009]]] }));
  add('rubber', side(rr(-0.383, -0.09, -0.362, 0.038, 0.006), 0.046, { bevel: 0.003 }));

  // ---- red-dot optic: hollow housing (cross-section extruded along the bore), mount, knob ----
  const hs = new THREE.Shape(rr(-0.024, 0.062, 0.024, 0.115, 0.009).map(([x, y]) => new THREE.Vector2(x, y)));
  hs.holes.push(new THREE.Path(rr(-0.018, 0.07, 0.018, 0.106, 0.006).map(([x, y]) => new THREE.Vector2(x, y))));
  const housing = new THREE.ExtrudeGeometry(hs, { depth: 0.064, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 8 });
  housing.translate(0, 0, -0.07);
  add('metal', housing);
  add('metal', box(0.032, 0.01, 0.046, 0, 0.066, 0.035));
  const knob = (r, l, x) => { const g = new THREE.CylinderGeometry(r, r, l, 16); g.rotateZ(Math.PI / 2); g.translate(x, 0.09, -0.035); return g; };
  add('metal', knob(0.008, 0.01, 0.029)); // brightness knob
  add('accent', knob(0.0082, 0.003, 0.0345));

  // ---- magazine (curved, separate so it can drop during reload) ----
  const ms = new THREE.Shape();
  ms.moveTo(0.027, -0.035); ms.lineTo(0.091, -0.035);
  ms.quadraticCurveTo(0.104, -0.12, 0.13, -0.192);
  ms.lineTo(0.134, -0.206); ms.lineTo(0.06, -0.212); ms.lineTo(0.058, -0.198);
  ms.quadraticCurveTo(0.038, -0.12, 0.027, -0.035);
  const magGeos = [side(null, 0.026, { bevel: 0.0025, curve: ms }).toNonIndexed()];
  const magAccent = box(0.03, 0.006, 0.07, 0, -0.211, 0.097, 0.07).toNonIndexed();

  const group = new THREE.Group();
  for (const [k, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list.filter(Boolean)), M[k]);
    group.add(mesh);
  }
  const mag = new THREE.Group();
  mag.add(new THREE.Mesh(mergeGeometries(magGeos), M.rubber), new THREE.Mesh(magAccent, M.accent));
  group.add(mag);

  // optic glass (faint blue-amber coating) and the projected dot
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.036), new THREE.MeshBasicMaterial({ color: 0x7fb6c8, transparent: true, opacity: 0.13, depthWrite: false }));
  glass.position.set(0, SIGHT_Y, -0.064); group.add(glass);
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  dot.scale.setScalar(0.008); dot.position.set(0, SIGHT_Y, -0.066); group.add(dot);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  flash.position.set(0, BORE, -0.66); flash.visible = false; group.add(flash);

  return { group, mag, flash };
}
