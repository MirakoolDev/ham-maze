// The level: maze walls, floor, sky, lights and the goal monolith. Look follows the Unity original (HAM):
// pastel concrete (left/right walls pink, front/back walls pale blue), a clear sky, soft grey fog, a pink monolith.
// Unity scale: the Maze Generator object is scaled x7, cell walls are 0.2 thick -> 7 m cells, 1.4 m walls, 7 m high.
// Unity (x, y, z) maps to three.js (x, y, -z) so the layout is not mirrored.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { urls } from './assets.js';

export let CELL = 7;
export const THICK = 1.4, HEIGHT = 7;
/** Called once before the world is built (admin setting). */
export function setCellSize(v) { CELL = v; }
export const cellCenter = (x, z) => new THREE.Vector3(x * CELL, 0, -z * CELL);

/** Box with UVs in world metres (tileM per texture repeat), so textures keep their scale on every wall. */
function box(cx, cy, cz, sx, sy, sz, tileM) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; each face 4 verts.
  const span = [[sz, sy, cz - sz / 2, cy - sy / 2], [sz, sy, cz - sz / 2, cy - sy / 2], [sx, sz, cx - sx / 2, cz - sz / 2],
    [sx, sz, cx - sx / 2, cz - sz / 2], [sx, sy, cx - sx / 2, cy - sy / 2], [sx, sy, cx - sx / 2, cy - sy / 2]];
  for (let f = 0; f < 6; f++) {
    const [w, h, ou, ov] = span[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * w + ou) / tileM, (uv.getY(i) * h + ov) / tileM);
    }
  }
  g.translate(cx, cy, cz);
  return g;
}

/** Floor AO: occupancy of wall footprints, box-blurred (3 separable passes ~ gaussian), as a texture on uv1. */
function bakeFloorAO(boxes, center, floorSize, size = 1024) {
  const occ = new Float32Array(size * size);
  const toPx = (x, z) => [((x - center.x) / floorSize + 0.5) * size, ((z - center.z) / floorSize + 0.5) * size];
  for (const b of boxes) {
    const [x0, z0] = toPx(b.x0, b.z0), [x1, z1] = toPx(b.x1, b.z1);
    for (let y = Math.max(0, Math.floor(z0)); y < Math.min(size, Math.ceil(z1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) occ[y * size + x] = 1;
  }
  const r = Math.round(size * 1.1 / floorSize); // ~1.1 m blur radius
  const tmp = new Float32Array(size * size);
  const pass = (src, dst, horiz) => {
    const w = 2 * r + 1;
    for (let j = 0; j < size; j++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) { const i = Math.min(size - 1, Math.max(0, k)); acc += horiz ? src[j * size + i] : src[i * size + j]; }
      for (let i = 0; i < size; i++) {
        if (horiz) dst[j * size + i] = acc / w; else dst[i * size + j] = acc / w;
        const add = Math.min(size - 1, i + r + 1), sub = Math.max(0, i - r);
        acc += horiz ? src[j * size + add] - src[j * size + sub] : src[add * size + j] - src[sub * size + j];
      }
    }
  };
  for (let n = 0; n < 3; n++) { pass(occ, tmp, true); pass(tmp, occ, false); }
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  for (let i = 0; i < occ.length; i++) { const v = 255 * (1 - Math.min(1, occ[i] * 1.5) * 0.8); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.channel = 1; t.colorSpace = THREE.NoColorSpace; t.flipY = false;
  return t;
}

const tl = new THREE.TextureLoader();
function concrete() {
  const load = (u, srgb) => { const t = tl.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: load(urls.concreteAlbedo, true), normalMap: load(urls.concreteNormal), roughnessMap: load(urls.concreteRough) };
}
// Unity material tints (concrete p / concrete b), brightened because the albedo scan is a mid grey
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace); // Unity colour pickers are sRGB
export const PALETTE = { pink: srgb(1, 0.8, 0.87), blue: srgb(0.74, 0.885, 1), white: srgb(0.95, 0.94, 0.97) };
const WALL_GAIN = 2.8;
/** Vertex colours by face direction: faces looking along x are pink (Unity's left/right walls), along z pale blue (front/back), tops white. */
function faceTint(g) {
  const col = new Float32Array(g.attributes.position.count * 3);
  const order = [PALETTE.pink, PALETTE.pink, PALETTE.white, PALETTE.white, PALETTE.blue, PALETTE.blue]; // BoxGeometry face order
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) order[f].toArray(col, (f * 4 + v) * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function buildWorld(scene, maze) {
  const { width: W, depth: D } = maze;
  const boxes = []; // xz AABBs for collision
  const geos = [];
  const add = (cx, cz, sx, sz) => {
    geos.push(faceTint(box(cx, HEIGHT / 2 - 0.025, cz, sx, HEIGHT + 0.05, sz, 6)));
    boxes.push({ x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2, h: HEIGHT });
  };

  // Walls between posts (length CELL - THICK), so collinear walls never overlap and z-fight.
  const L = CELL - THICK;
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) {
      const c = maze.cell(x, z), C = cellCenter(x, z);
      if (x === 0 && c.L) add(C.x - CELL / 2, C.z, THICK, L);
      if (c.R) add(C.x + CELL / 2, C.z, THICK, L);
      if (z === 0 && c.B) add(C.x, C.z + CELL / 2, L, THICK);
      if (c.F) add(C.x, C.z - CELL / 2, L, THICK);
    }
  }
  // A post on every grid corner (in a perfect maze every corner touches at least one wall).
  for (let i = 0; i <= W; i++) for (let j = 0; j <= D; j++) add((i - 0.5) * CELL, -(j - 0.5) * CELL, THICK, THICK);

  const maps = concrete();
  const wallMat = (tint) => {
    const m = new THREE.MeshStandardMaterial({ ...maps, color: tint.clone().multiplyScalar(WALL_GAIN), roughness: 0.9, metalness: 0, normalScale: new THREE.Vector2(0.35, 0.35) });
    // soft contact occlusion at the foot of every wall (indirect light only)
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float wao = mix(0.55, 1.0, smoothstep(0.0, 2.0, vWY)); reflectedLight.indirectDiffuse *= wao; reflectedLight.indirectSpecular *= wao; reflectedLight.directDiffuse *= mix(0.72, 1.0, smoothstep(0.0, 0.45, vWY)); }');
    };
    return m;
  };
  const walls = new THREE.Mesh(mergeGeometries(geos), wallMat(new THREE.Color(1, 1, 1)));
  walls.material.vertexColors = true;
  walls.material.shadowSide = THREE.FrontSide; // shadow depth from the sun-facing faces: no lit seam at the foot of shaded walls
  walls.castShadow = walls.receiveShadow = true;
  scene.add(walls);

  // Floor
  const center = cellCenter((W - 1) / 2, (D - 1) / 2);
  const floorSize = Math.max(W, D) * CELL + 160;
  const floorGeo = new THREE.PlaneGeometry(floorSize, floorSize);
  floorGeo.rotateX(-Math.PI / 2);
  const fuv = floorGeo.attributes.uv;
  for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * floorSize / 8, fuv.getY(i) * floorSize / 8);
  // Ambient occlusion baked from the maze footprint: walls drawn into a canvas, blurred, used as the floor's aoMap (uv1 = 0..1).
  const uv1 = new Float32Array(fuv.count * 2);
  for (let i = 0; i < fuv.count; i++) { uv1[i * 2] = floorGeo.attributes.position.getX(i) / floorSize + 0.5; uv1[i * 2 + 1] = 0.5 + floorGeo.attributes.position.getZ(i) / floorSize; }
  floorGeo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  const aoMap = bakeFloorAO(boxes, center, floorSize);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({ ...maps, aoMap, aoMapIntensity: 0.8, color: new THREE.Color(0.95, 0.94, 0.97).multiplyScalar(2.3), roughness: 0.85, metalness: 0, normalScale: new THREE.Vector2(0.2, 0.2) }));
  // contact shadow: the baked occlusion also dims direct sun right at the foot of each wall, so walls sit on the floor
  floor.material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>',
      '#include <aomap_fragment>\nreflectedLight.directDiffuse *= mix(0.5, 1.0, smoothstep(0.42, 0.92, ambientOcclusion));');
  };
  floor.position.set(center.x, 0, center.z);
  floor.receiveShadow = true;
  scene.add(floor);

  // Clear sky (Unity used a 'pure sky' HDRI); high white sun so one face of each corridor is lit and the other sits in lavender shade
  const sunDir = new THREE.Vector3(-0.42, 0.78, -0.46).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 sunDir; uniform float uTime; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zen = vec3(0.2, 0.38, 0.8), mid = vec3(0.42, 0.58, 0.88), hor = vec3(0.8, 0.84, 0.92);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h)); c = mix(c, zen, smoothstep(0.2, 0.85, h));
        float s = max(dot(d, sunDir), 0.0);
        c += vec3(1.0, 0.95, 0.88) * pow(s, 24.0) * 0.5;
        if (h > 0.0) { // a few thin high wisps, drifting slowly
          vec2 p = d.xz / (h + 0.15) * vec2(0.5, 1.4) + vec2(uTime * 0.004, 0.0);
          float n = fbm(p);
          c = mix(c, vec3(1.0, 0.98, 1.0) * 1.05, smoothstep(0.55, 0.8, n) * smoothstep(0.02, 0.25, h) * 0.45);
        }
        c += vec3(1.0, 0.97, 0.9) * smoothstep(0.9993, 0.9997, s) * 8.0;
        c = mix(c, hor * 0.95, smoothstep(0.0, -0.1, h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  scene.add(sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(0.74, 0.77, 0.86), 0.007 * Math.min(1, 84 / (Math.max(W, D) * CELL)));
  scene.background = new THREE.Color(0.8, 0.82, 0.9);

  scene.add(new THREE.HemisphereLight(0xc4d2ff, 0xf0dce4, 2.5));
  const sun = new THREE.DirectionalLight(0xfff3e8, 3.2);
  sun.position.copy(center).addScaledVector(sunDir, 140);
  sun.target.position.copy(center);
  sun.castShadow = true;
  const sc = sun.shadow.camera, r = Math.max(W, D) * CELL * 0.62;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 320;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.012; sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // Goal monolith: a 3 m square shaft of translucent orange glass, MONO_H tall so it shows over the walls from anywhere.
  // A bright core glows through the shell; the edges catch a fresnel rim, the base burns hotter and the top dissolves into the sky.
  const gc = cellCenter(maze.goal.x, maze.goal.z);
  const MONO_H = 160;
  const orange = srgb(0.95, 0.34, 0.06);
  const shellMat = new THREE.MeshStandardMaterial({ color: orange, emissive: srgb(1, 0.3, 0.04), emissiveIntensity: 0.4, roughness: 0.14, metalness: 0, transparent: true, opacity: 0.84, depthWrite: false, fog: false });
  shellMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vMY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMY;')
      .replace('#include <dithering_fragment>', `
        float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 3.0);
        gl_FragColor.rgb += vec3(1.0, 0.55, 0.25) * fr * 0.5;
        gl_FragColor.rgb += vec3(1.0, 0.5, 0.22) * 0.35 * (1.0 - smoothstep(0.0, 5.0, vMY));
        gl_FragColor.a = clamp(gl_FragColor.a + fr * 0.2, 0.0, 1.0) * (1.0 - 0.5 * smoothstep(50.0, ${MONO_H.toFixed(1)}, vMY));
        #include <dithering_fragment>`);
  };
  const shellGeo = new THREE.BoxGeometry(3, MONO_H, 3); shellGeo.translate(0, MONO_H / 2, 0);
  const pillar = new THREE.Mesh(shellGeo, shellMat);
  pillar.position.set(gc.x, 0, gc.z); pillar.renderOrder = 2;
  // the core ignores fog so it reads through the haze across the whole maze; HDR colour so bloom halos it
  const coreMat = new THREE.MeshBasicMaterial({ color: srgb(1, 0.45, 0.12).multiplyScalar(1.5), transparent: true, opacity: 0.55, depthWrite: false, fog: false });
  const coreGeo = new THREE.BoxGeometry(1.5, MONO_H, 1.5); coreGeo.translate(0, MONO_H / 2, 0);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.copy(pillar.position); core.renderOrder = 1;
  scene.add(core, pillar);
  const pillarMat = shellMat;
  // shockwave ring for the moment you reach it
  const ringMat = new THREE.MeshBasicMaterial({ color: srgb(1, 0.5, 0.18).multiplyScalar(2.2), transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 96), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.set(gc.x, 0.06, gc.z); ring.visible = false;
  scene.add(ring);
  let surge = -1; // seconds since the monolith was reached, -1 = idle
  // pale motes drifting up around it, and a soft pink light on the surrounding walls
  const MOTES = 60, mp = new Float32Array(MOTES * 3), mseed = [];
  for (let i = 0; i < MOTES; i++) mseed.push({ a: Math.random() * 6.28, r: 2 + Math.random() * 1.8, y: Math.random() * 30, v: 0.3 + Math.random() * 0.6 });
  const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: new THREE.Color(1.7, 1.15, 0.8), size: 0.08, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  motes.frustumCulled = false; scene.add(motes);
  // kept tight to the goal room: point lights aren't blocked by walls, so a long reach here bled
  // warm light straight through into neighbouring corridors. CELL (~7) is one room's width.
  const glow = new THREE.PointLight(0xff9450, 16, CELL * 1.35, 2.2);
  glow.position.set(gc.x, 3, gc.z);
  scene.add(glow);
  const goalBox = { x0: gc.x - 1.5, x1: gc.x + 1.5, z0: gc.z - 1.5, z1: gc.z + 1.5, h: MONO_H };
  boxes.push(goalBox);

  /** Push a circle (radius r) at p out of every wall box, in xz. */
  function collide(p, rad) {
    for (let pass = 0; pass < 2; pass++) {
      for (const b of boxes) {
        if (p.x < b.x0 - rad || p.x > b.x1 + rad || p.z < b.z0 - rad || p.z > b.z1 + rad) continue;
        const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rad * rad) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (rad - d) / d;
          p.x += dx * k; p.z += dz * k;
        } else { // centre inside the box: leave along the shortest axis
          const ex = [b.x0 - rad - p.x, b.x1 + rad - p.x], ez = [b.z0 - rad - p.z, b.z1 + rad - p.z];
          const mx = Math.abs(ex[0]) < Math.abs(ex[1]) ? ex[0] : ex[1], mz = Math.abs(ez[0]) < Math.abs(ez[1]) ? ez[0] : ez[1];
          if (Math.abs(mx) < Math.abs(mz)) p.x += mx; else p.z += mz;
        }
      }
    }
  }

  /** Touching the pillar ends the run (Unity: OnTriggerEnter on the goal). */
  function reachedGoal(p, rad) {
    const cx = Math.max(goalBox.x0, Math.min(p.x, goalBox.x1)), cz = Math.max(goalBox.z0, Math.min(p.z, goalBox.z1));
    return Math.hypot(p.x - cx, p.z - cz) < rad + 0.35;
  }

  /** Ray vs walls (3D boxes) and floor. Returns { t, point, normal } or null. d must be normalized. */
  function raycast(o, d, maxT = 300) {
    let best = maxT, nx = 0, ny = 0, nz = 0, hit = false;
    if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; nx = 0; ny = 1; nz = 0; hit = true; } }
    for (const b of boxes) {
      let t0 = -Infinity, t1 = Infinity, ax = 0, sign = 0;
      const lo = [b.x0, 0, b.z0], hi = [b.x1, b.h, b.z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
      let miss = false;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < lo[a] || oo[a] > hi[a]) { miss = true; break; } continue; }
        let ta = (lo[a] - oo[a]) / dd[a], tb = (hi[a] - oo[a]) / dd[a], s = -1;
        if (ta > tb) { const q = ta; ta = tb; tb = q; s = 1; }
        if (ta > t0) { t0 = ta; ax = a; sign = s; }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { miss = true; break; }
      }
      if (miss || t0 <= 0 || t0 >= best) continue;
      best = t0; hit = true; nx = ax === 0 ? sign : 0; ny = ax === 1 ? sign : 0; nz = ax === 2 ? sign : 0;
    }
    if (!hit) return null;
    return { t: best, point: new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best), normal: new THREE.Vector3(nx, ny, nz) };
  }

  /** Clear line between two points in xz (walls are taller than anything that looks over them). */
  function los(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    for (const bx of boxes) {
      let t0 = 0, t1 = 1, miss = false;
      for (const [o, d, lo, hi] of [[a.x, dx, bx.x0, bx.x1], [a.z, dz, bx.z0, bx.z1]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { miss = true; break; } continue; }
        let ta = (lo - o) / d, tb = (hi - o) / d;
        if (ta > tb) { const q = ta; ta = tb; tb = q; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { miss = true; break; }
      }
      if (!miss) return false;
    }
    return true;
  }

  /** Is a point inside any wall (for projectiles)? */
  function solidAt(p) {
    if (p.y <= 0) return true;
    for (const b of boxes) if (p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1 && p.y < b.h) return true;
    return false;
  }

  /** Cell index under a world position, and open neighbours of a cell (for enemy path-finding). */
  const cellOf = (p) => ({ x: Math.max(0, Math.min(W - 1, Math.round(p.x / CELL))), z: Math.max(0, Math.min(D - 1, Math.round(-p.z / CELL))) });
  function neighbours(x, z) {
    const c = maze.cell(x, z), out = [];
    if (!c.R && x + 1 < W) out.push([x + 1, z]);
    if (!c.L && x - 1 >= 0) out.push([x - 1, z]);
    if (!c.F && z + 1 < D) out.push([x, z + 1]);
    if (!c.B && z - 1 >= 0) out.push([x, z - 1]);
    return out;
  }
  /** Breadth-first path between cells: [[x,z], ...] from start (exclusive) to goal (inclusive). */
  function path(from, to) {
    const key = (x, z) => x * D + z, prev = new Map([[key(from.x, from.z), -1]]), q = [[from.x, from.z]];
    while (q.length) {
      const [x, z] = q.shift();
      if (x === to.x && z === to.z) break;
      for (const [a, b] of neighbours(x, z)) if (!prev.has(key(a, b))) { prev.set(key(a, b), key(x, z)); q.push([a, b]); }
    }
    const out = [];
    let k = key(to.x, to.z);
    if (!prev.has(k)) return out;
    while (k !== key(from.x, from.z) && k !== -1) { out.unshift([Math.floor(k / D), k % D]); k = prev.get(k); }
    return out;
  }

  function update(dt, t, camera) {
    sky.position.copy(camera.position);
    sky.material.uniforms.uTime.value = t;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
    pillarMat.emissiveIntensity = 0.28 + pulse * 0.16;
    coreMat.opacity = 0.45 + pulse * 0.2;
    if (surge >= 0) {
      surge += dt;
      const s = surge, flash = Math.exp(-s * 1.6) * (1 + 0.35 * Math.sin(s * 18) * Math.exp(-s * 2.5));
      pillarMat.emissiveIntensity += flash * 2.4;
      coreMat.opacity = Math.min(1, coreMat.opacity + flash * 0.6);
      core.scale.set(1 + flash * 0.5, 1, 1 + flash * 0.5);
      glow.intensity += flash * 260;
      const r = 1.5 + s * 26;
      ring.visible = s < 2.4; ring.scale.setScalar(r); ringMat.opacity = Math.max(0, 1 - s / 2.4) * 0.9;
    }
    glow.intensity = 24 + pulse * 12;
    for (let i = 0; i < MOTES; i++) {
      const m = mseed[i]; const boost = surge >= 0 ? 1 + 9 * Math.exp(-surge * 1.2) : 1; m.y += m.v * dt * boost; m.a += dt * 0.15 * boost;
      if (m.y > 30) { m.y = 0; m.r = 2 + Math.random() * 1.8; }
      mp[i * 3] = gc.x + Math.cos(m.a) * m.r; mp[i * 3 + 1] = m.y; mp[i * 3 + 2] = gc.z + Math.sin(m.a) * m.r;
    }
    moteGeo.attributes.position.needsUpdate = true;
  }

  return {
    boxes, collide, reachedGoal, update, raycast, los, solidAt, cellOf, neighbours, path,
    /** The run is over: the monolith surges, a ring rolls out across the maze. */
    celebrate() { surge = 0; },
    spawn: cellCenter(0, 0), goal: new THREE.Vector3(gc.x, 0, gc.z), center, sunDir, sun,
    /** Shadow quality: 0 = off, else the shadow map size. */
    setShadows(size) {
      sun.castShadow = size > 0;
      if (size > 0 && sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    },
  };
}
