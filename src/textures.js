// Procedural, tiling concrete maps drawn into canvases: nothing is downloaded.
import * as THREE from 'three';

function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Tiling value noise, 0..1. */
function valueNoise(size, period, rnd) {
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
    const y0 = iy % period, y1 = (iy + 1) % period;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
      const x0 = ix % period, x1 = (ix + 1) % period;
      const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
      out[y * size + x] = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
    }
  }
  return out;
}

function fbm(size, base, octaves, seed) {
  const rnd = lcg(seed);
  const out = new Float32Array(size * size);
  let amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function toTexture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  return t;
}

/**
 * Concrete maps. One tile = `tileMeters` of surface.
 * kind 'wall': cast-in-place panels with horizontal pour lines and form-tie holes.
 * kind 'floor': slabs with saw-cut joints, darker, damp patches (lower roughness).
 */
export function concreteMaps(kind, seed = 1, size = 512) {
  const h = fbm(size, 4, 6, seed);
  const blot = fbm(size, 3, 3, seed + 11);
  const fine = fbm(size, 64, 2, seed + 23);
  const height = new Float32Array(size * size);
  const col = document.createElement('canvas'); col.width = col.height = size;
  const rough = document.createElement('canvas'); rough.width = rough.height = size;
  const cctx = col.getContext('2d'), rctx = rough.getContext('2d');
  const cimg = cctx.createImageData(size, size), rimg = rctx.createImageData(size, size);
  const wall = kind === 'wall';
  const base = wall ? [184, 177, 166] : [138, 132, 124];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = h[i], b = blot[i], f = fine[i];
      let seam = 0;
      if (wall) {
        const yy = y % (size / 2);
        if (yy < 2) seam = 1; // pour line every half tile
        const tx = (x + size / 8) % (size / 4), ty = (y + size / 8) % (size / 4); // tie holes on a grid
        const dx = tx - size / 8, dy = ty - size / 8;
        if (dx * dx + dy * dy < 16) seam = Math.max(seam, 0.9);
      } else if (x % size < 2 || y % size < 2) seam = 1; // slab joints at tile edges
      const stain = Math.max(0, b - 0.52) * 2.2;
      let k = 0.78 + (v - 0.5) * 0.5 + (f - 0.5) * 0.18 - stain * 0.35 - seam * 0.45;
      if (wall) k -= Math.max(0, 0.35 - y / size) * 0.25 * b; // darker base where water splashes up
      cimg.data[i * 4] = Math.min(255, base[0] * k);
      cimg.data[i * 4 + 1] = Math.min(255, base[1] * k * (1 - stain * 0.04));
      cimg.data[i * 4 + 2] = Math.min(255, base[2] * k * (1 - stain * 0.08));
      cimg.data[i * 4 + 3] = 255;
      height[i] = v * 0.6 + f * 0.4 - seam * 0.25;
      const damp = wall ? 0 : Math.max(0, b - 0.55) * 3;
      const r = Math.max(0.12, Math.min(1, (wall ? 0.88 : 0.72) + (f - 0.5) * 0.2 - damp * 0.55)) * 255;
      rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = r; rimg.data[i * 4 + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);

  // Normal map from height (wrapping Sobel).
  const nrm = document.createElement('canvas'); nrm.width = nrm.height = size;
  const nctx = nrm.getContext('2d'), nimg = nctx.createImageData(size, size);
  const H = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  const strength = wall ? 0.9 : 0.8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1));
      const dy = (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1)) - (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      nimg.data[i] = (nx * 0.5 + 0.5) * 255; nimg.data[i + 1] = (ny * 0.5 + 0.5) * 255; nimg.data[i + 2] = (nz * 0.5 + 0.5) * 255; nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);

  return { map: toTexture(col, true), normalMap: toTexture(nrm, false), roughnessMap: toTexture(rough, false) };
}
