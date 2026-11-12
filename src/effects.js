// Pooled sparks, bullet-hole decals, tracers and a muzzle light (constant light count: no shader recompiles).
import * as THREE from 'three';

export function createEffects(scene) {
  // ---- sparks ----
  const MAX = 600;
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  const parts = [];
  const c = new THREE.Color();

  function sparks(p, normal, count, color, speed = 6) {
    c.setHex(color);
    for (let i = 0; i < count; i++) {
      if (parts.length >= MAX) parts.shift();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().addScaledVector(normal, 1.2).normalize()
        .multiplyScalar(speed * (0.3 + Math.random()));
      const life = 0.25 + Math.random() * 0.45;
      parts.push({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life, max: life, r: c.r, g: c.g, b: c.b });
    }
  }
  const burst = (p, color, count, speed) => sparks(p, new THREE.Vector3(0, 0.4, 0), count, color, speed);

  // ---- decals ----
  const holeTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(8,8,8,1)'); r.addColorStop(0.28, 'rgba(20,18,16,.95)'); r.addColorStop(0.5, 'rgba(60,56,50,.5)'); r.addColorStop(1, 'rgba(60,56,50,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const decalMat = new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 });
  const decalGeo = new THREE.PlaneGeometry(0.22, 0.22);
  const decals = [];
  function hole(p, n) {
    let m;
    if (decals.length >= 80) m = decals.shift(); else { m = new THREE.Mesh(decalGeo, decalMat); scene.add(m); }
    m.position.copy(p).addScaledVector(n, 0.01);
    m.lookAt(p.clone().add(n));
    m.rotation.z += Math.random() * 6.28;
    m.scale.setScalar(0.7 + Math.random() * 0.5);
    decals.push(m);
  }

  // ---- tracers ----
  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd090, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  function tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const l = new THREE.Line(g, tracerMat.clone());
    scene.add(l); tracers.push({ l, t: 0.06 });
  }

  // ---- muzzle light (always in the scene) ----
  const muzzle = new THREE.PointLight(0xffb070, 0, 14, 2);
  scene.add(muzzle);
  let muzzleT = 0;
  function flash(p) { muzzle.position.copy(p); muzzleT = 0.05; }

  function clear() {
    parts.length = 0;
    for (const d of decals) scene.remove(d);
    decals.length = 0;
  }

  // ---- dust hanging in the corridors, kept in a box around the camera ----
  const DUST = 260, DR = 14;
  const dustPos = new Float32Array(DUST * 3), dustVel = [];
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * DR * 2; dustPos[i * 3 + 1] = Math.random() * 6; dustPos[i * 3 + 2] = (Math.random() - 0.5) * DR * 2;
    dustVel.push([(Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.15]);
  }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffd9b0, size: 0.025, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);
  function updateDust(dt, cam) {
    for (let i = 0; i < DUST; i++) {
      const j = i * 3, v = dustVel[i];
      dustPos[j] += v[0] * dt; dustPos[j + 1] += v[1] * dt; dustPos[j + 2] += v[2] * dt;
      // wrap into the box around the camera
      for (const [a, c, r] of [[0, cam.x, DR], [2, cam.z, DR]]) {
        if (dustPos[j + a] < c - r) dustPos[j + a] += 2 * r; else if (dustPos[j + a] > c + r) dustPos[j + a] -= 2 * r;
      }
      if (dustPos[j + 1] < 0) dustPos[j + 1] += 6; else if (dustPos[j + 1] > 6) dustPos[j + 1] -= 6;
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  function update(dt, cam) {
    if (cam) updateDust(dt, cam);
    let n = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.life -= dt;
      if (q.life <= 0) { parts.splice(i, 1); continue; }
      q.vy -= 14 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.02) { q.y = 0.02; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
    }
    for (const q of parts) {
      const k = q.life / q.max;
      pos[n * 3] = q.x; pos[n * 3 + 1] = q.y; pos[n * 3 + 2] = q.z;
      col[n * 3] = q.r * k * 2; col[n * 3 + 1] = q.g * k * 2; col[n * 3 + 2] = q.b * k * 2;
      n++;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;

    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i]; t.t -= dt;
      t.l.material.opacity = Math.max(0, t.t / 0.06);
      if (t.t <= 0) { scene.remove(t.l); t.l.geometry.dispose(); t.l.material.dispose(); tracers.splice(i, 1); }
    }
    muzzleT -= dt;
    muzzle.intensity = muzzleT > 0 ? 40 : 0;
  }

  return { sparks, burst, hole, tracer, flash, update, clear };
}
