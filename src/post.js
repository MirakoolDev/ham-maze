// Post-processing chain: world -> weapon (own depth) -> bloom (HDR) -> tone map + sRGB -> FXAA -> grade.
// Grade (display space): split-tone, saturation, vignette (tightens when aiming), red edge when hurt,
// chromatic fringe that grows with damage, animated grain + dither against banding in the sky.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uHurt: { value: 0 }, uLowHp: { value: 0 }, uAds: { value: 0 },
    uSat: { value: 1.04 }, uRes: { value: new THREE.Vector2(1, 1) }, uGrain: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uHurt, uLowHp, uAds, uSat, uGrain; uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float ca = 0.0012 + uHurt * 0.007;
      vec3 col = vec3(texture2D(tDiffuse, vUv - c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + c * ca).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, col * vec3(0.97, 0.97, 1.05), (1.0 - l) * 0.3);  // lavender shade
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * 1.06 + 0.5;                                  // Unity: contrast +15 (gentle here)
      float vig = smoothstep(0.95, 0.35 - uAds * 0.1, length(c * vec2(1.0, 0.8)));
      col = mix(col * vec3(0.78, 0.66, 0.68), col, mix(0.6 - uAds * 0.2, 1.0, vig)); // soft warm vignette (Unity: 0.2, reddish)
      float edge = smoothstep(0.25, 0.75, length(c));
      col = mix(col, vec3(0.55, 0.04, 0.02), edge * clamp(uHurt * 0.85 + uLowHp * (0.45 + 0.1 * sin(uTime * 5.0)), 0.0, 0.85));
      float n = h(vUv * uRes + fract(uTime * 7.31) * 100.0);
      col += (n - 0.5) * (0.035 * uGrain + 0.004); // film grain
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export function createPost(renderer, scene, camera, weapon) {
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const main = new RenderPass(scene, camera);
  const gun = new RenderPass(weapon.scene, weapon.cam);
  gun.clear = false; gun.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.7, 0.92);
  const output = new OutputPass();
  const fxaa = new ShaderPass(FXAAShader);
  const grade = new ShaderPass(GradeShader);
  for (const p of [main, gun, bloom, output, fxaa, grade]) composer.addPass(p);

  const post = { composer, bloom, grade, fxaa, gun, quality: 'high' };

  post.resize = (w, h, pr) => {
    composer.setPixelRatio(pr); composer.setSize(w, h);
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    grade.uniforms.uRes.value.set(w * pr, h * pr);
  };
  post.setQuality = (q) => {
    post.quality = q;
    bloom.enabled = q !== 'low';
    const samples = q === 'high' ? 4 : 0;
    for (const r of [composer.renderTarget1, composer.renderTarget2]) if (r.samples !== samples) { r.samples = samples; r.dispose(); }
    fxaa.enabled = q !== 'high';
  };
  post.render = (dt, { showGun, hurt, lowHp, ads }) => {
    const u = grade.uniforms;
    u.uTime.value += dt; u.uHurt.value = hurt; u.uLowHp.value = lowHp; u.uAds.value = ads;
    gun.enabled = showGun;
    composer.render(dt);
  };
  return post;
}
