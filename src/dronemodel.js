// Sentry: a floating sculpture from the same family as the monolith. Two soft-edged blocks (cream over pale blue)
// held apart by a glowing pink seam, one lens eye on the front, a thin halo that turns, and three small cubes in orbit.
// Front is -Z. API: { group, eyeLocal, eyeRadius, animate(dt, { mode, charge, speed, fwdSpeed, flash }), kill() }.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

let S = null; // shared geometry and textures

function irisTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.translate(128, 128);
  g.fillStyle = '#000'; g.fillRect(-128, -128, 256, 256);
  const ring = (r, w, a) => { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  ring(112, 5, 0.85); ring(84, 2, 0.5);
  for (let i = 0; i < 24; i++) { g.rotate(Math.PI / 12); g.fillStyle = `rgba(255,255,255,${i % 2 ? 0.25 : 0.55})`; g.fillRect(56, -1.5, 22, 3); }
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 40); core.addColorStop(0, '#fff'); core.addColorStop(0.55, 'rgba(255,255,255,.85)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
  return new THREE.CanvasTexture(c);
}

function shared() {
  if (S) return S;
  S = {
    half: new RoundedBoxGeometry(0.78, 0.34, 0.78, 4, 0.11),
    seam: new THREE.BoxGeometry(0.75, 0.06, 0.75),
    socket: new THREE.CylinderGeometry(0.17, 0.17, 0.08, 40),
    rim: new THREE.TorusGeometry(0.165, 0.016, 10, 48),
    lens: new THREE.SphereGeometry(0.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    iris: new THREE.CircleGeometry(0.13, 40),
    halo: new THREE.TorusGeometry(0.66, 0.011, 8, 96),
    moon: new RoundedBoxGeometry(0.12, 0.12, 0.12, 2, 0.03),
    irisTex: irisTexture(),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2934, roughness: 0.5, metalness: 0.2 }),
    lensMat: new THREE.MeshStandardMaterial({ color: 0x15131c, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
  };
  return S;
}

const COLOR = { patrol: new THREE.Color(1.0, 0.5, 0.66), hunt: new THREE.Color(1.0, 0.16, 0.22) };
const HOT = new THREE.Color(1, 0.9, 0.95);

export function buildDrone() {
  const s = shared();
  const root = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.95, 0.91, 0.85, THREE.SRGBColorSpace).multiplyScalar(0.8), roughness: 0.82 });
  const blue = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.6, 0.74, 0.97, THREE.SRGBColorSpace).multiplyScalar(0.9), roughness: 0.82 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const irisMat = new THREE.MeshBasicMaterial({ map: s.irisTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

  const top = new THREE.Mesh(s.half, cream); top.castShadow = true;
  const bot = new THREE.Mesh(s.half, blue); bot.castShadow = true;
  const seam = new THREE.Mesh(s.seam, glow);
  root.add(top, bot, seam);

  // eye: dark socket set into the front face, white rim, iris glow under a glossy lens; it straddles the seam
  const eye = new THREE.Group(); eye.position.z = -0.39;
  const socket = new THREE.Mesh(s.socket, s.dark); socket.rotation.x = Math.PI / 2; eye.add(socket);
  const rim = new THREE.Mesh(s.rim, cream); rim.position.z = -0.04; eye.add(rim);
  const iris = new THREE.Mesh(s.iris, irisMat); iris.position.z = -0.045; iris.rotation.y = Math.PI; eye.add(iris);
  const lens = new THREE.Mesh(s.lens, s.lensMat); lens.rotation.x = -Math.PI / 2; lens.position.z = -0.04; lens.scale.set(1, 0.5, 1); eye.add(lens);
  root.add(eye);

  const halo = new THREE.Mesh(s.halo, haloMat); halo.rotation.x = Math.PI / 2 - 0.35; root.add(halo);
  const moons = [0, 1, 2].map((i) => { const m = new THREE.Mesh(s.moon, i === 1 ? blue : cream); m.castShadow = true; root.add(m); return m; });

  let t = Math.random() * 10, open = 0, dead = false;
  const col = new THREE.Color();
  const place = () => { top.position.y = 0.2 + open * 0.07; bot.position.y = -0.2 - open * 0.07; };
  place();

  return {
    group: root,
    eyeLocal: new THREE.Vector3(0, 0, -0.44), eyeRadius: 0.17,
    animate(dt, { mode, charge, fwdSpeed, flash }) {
      t += dt;
      if (dead) return;
      const charging = charge > 0;
      open += ((charging ? 1 : 0) - open) * (1 - Math.exp(-12 * dt));
      place();
      const pulse = charging ? 0.65 + 0.35 * Math.sin(t * 55) : 0.85 + 0.15 * Math.sin(t * 2.2);
      col.copy(charging ? HOT : COLOR[mode] || COLOR.patrol);
      const k = (charging ? 7 : mode === 'hunt' ? 3.2 : 1.8) * pulse;
      glow.color.copy(col).multiplyScalar(k);
      irisMat.color.copy(col).multiplyScalar(k * 0.9);
      haloMat.color.copy(col).multiplyScalar(mode === 'hunt' || charging ? 1.6 : 0.9);
      iris.rotation.z += dt * (mode === 'hunt' ? 2.4 : 0.6);
      iris.scale.setScalar(charging ? 0.75 + 0.25 * Math.sin(t * 28) : 1);
      halo.rotation.z += dt * (mode === 'hunt' ? 1.6 : 0.5);
      halo.rotation.x = Math.PI / 2 - 0.35 + Math.sin(t * 0.7) * 0.12;
      const spin = t * (mode === 'hunt' ? 1.5 : 0.7);
      moons.forEach((m, i) => {
        const a = spin + (i * Math.PI * 2) / 3;
        m.position.set(Math.cos(a) * 0.72, Math.sin(t * 1.3 + i * 2) * 0.16, Math.sin(a) * 0.72);
        m.rotation.set(t * 0.9 + i, t * 1.1, 0);
      });
      top.rotation.x = bot.rotation.x = -fwdSpeed * 0.03; // lean into the move
      const f = flash > 0 ? 0.8 : 0;
      cream.emissive.setScalar(f); blue.emissive.setScalar(f);
    },
    kill() {
      dead = true;
      glow.color.setScalar(0); irisMat.color.setScalar(0); haloMat.opacity = 0;
      cream.color.multiplyScalar(0.45); blue.color.multiplyScalar(0.45); cream.emissive.setScalar(0); blue.emissive.setScalar(0);
      top.position.set(0.05, 0.3, 0); top.rotation.set(0.2, 0.3, 0.45); // the blocks come apart
      moons.forEach((m, i) => m.position.set(Math.cos(i * 2.1) * 0.5, -0.32, Math.sin(i * 2.1) * 0.5));
    },
  };
}
