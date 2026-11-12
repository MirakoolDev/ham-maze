// The carbine: viewmodel drawn in its own pass (never clips into walls), hitscan firing, ADS, reload, recoil.
import * as THREE from 'three';
import { buildGun, SIGHT_Y } from './gunmodel.js';

export const MAG = 30;
const RESERVE = 150, RPM = 620, RELOAD_T = 1.9;
const HIP = new THREE.Vector3(0.16, -0.215, -0.6), HIP_YAW = 0.13, HIP_PITCH = 0.03;
const ADS = new THREE.Vector3(0, -SIGHT_Y, -0.21);
export function createWeapon(envMap) {
  const scene = new THREE.Scene();
  scene.environment = envMap; scene.environmentIntensity = 0.6;
  const cam = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
  scene.add(new THREE.HemisphereLight(0xc4d2ff, 0x6a5470, 1.0));
  const key = new THREE.DirectionalLight(0xfff3e8, 1.5); key.position.set(-1.5, 1.2, 1); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffa3bd, 1.2); rim.position.set(1.5, 0.5, -1); scene.add(rim);
  const { group, mag, flash } = buildGun();
  const rig = new THREE.Group(); rig.add(group); scene.add(rig);
  const magHome = mag.position.clone();

  const w = {
    scene, cam, mag: MAG, reserve: RESERVE, reloading: 0, ads: 0, shots: 0, hits: 0, spread: 0,
    onShoot: null, onEmpty: null, onReload: null,
    cd: 0, kick: 0, flashT: 0, swayX: 0, swayY: 0, bloom: 0, sprintPose: 0,
  };

  w.reset = () => { w.mag = MAG; w.reserve = RESERVE; w.reloading = 0; w.ads = 0; w.shots = 0; w.hits = 0; w.bloom = 0; w.cd = 0; };
  w.startReload = () => {
    if (w.reloading > 0 || w.mag >= MAG || w.reserve <= 0) return;
    w.reloading = RELOAD_T; w.onReload && w.onReload();
  };

  /** ctx: { inp, player, camera, sprinting, moving } */
  w.update = (dt, { inp, player, camera, sprinting, moveSpeed }) => {
    w.cd -= dt;
    if (w.reloading > 0) {
      w.reloading -= dt;
      if (w.reloading <= 0) { const n = Math.min(MAG - w.mag, w.reserve); w.mag += n; w.reserve -= n; w.reloading = 0; }
    }
    if (inp.pressed.has('KeyR')) w.startReload();

    const wantAds = inp.ads && w.reloading <= 0 && !sprinting;
    w.ads += ((wantAds ? 1 : 0) - w.ads) * (1 - Math.exp(-14 * dt));
    w.sprintPose += ((sprinting ? 1 : 0) - w.sprintPose) * (1 - Math.exp(-8 * dt));
    w.bloom = Math.max(0, w.bloom - dt * 0.09);

    if (inp.fire && w.cd <= 0 && w.reloading <= 0 && w.sprintPose < 0.5) {
      if (w.mag > 0) {
        w.mag--; w.shots++; w.cd = 60 / RPM;
        const base = 0.0016 + (1 - w.ads) * 0.011 + Math.min(moveSpeed / 9, 1) * (1 - w.ads * 0.7) * 0.018 + (player.grounded ? 0 : 0.03);
        w.spread = base + w.bloom;
        w.bloom = Math.min(0.03, w.bloom + 0.0035 * (1 - w.ads * 0.6));
        const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * w.spread;
        dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
        // recoil: climbs, drifts a little sideways
        player.pitch = Math.min(1.5, player.pitch + 0.0105 * (1 - w.ads * 0.4));
        player.yaw += (Math.random() - 0.45) * 0.005;
        w.kick = 1; w.flashT = 0.045;
        // muzzle position in world space (hip: lower right; ADS: just under the line of sight)
        const muzzle = camera.position.clone().addScaledVector(dir, 0.7)
          .addScaledVector(right, 0.17 * (1 - w.ads)).addScaledVector(up, -0.15 * (1 - w.ads) - 0.06 * w.ads);
        w.onShoot && w.onShoot(camera.position.clone(), dir, muzzle);
        if (w.mag === 0 && w.reserve > 0) setTimeout(() => w.startReload(), 250);
      } else if (inp.firePressed) {
        w.onEmpty && w.onEmpty();
        w.startReload();
      }
    }

    // ---- viewmodel animation ----
    w.kick += (0 - w.kick) * (1 - Math.exp(-18 * dt));
    w.swayX += (-inp.look.dx * 0.00035 - w.swayX) * (1 - Math.exp(-10 * dt));
    w.swayY += (inp.look.dy * 0.00035 - w.swayY) * (1 - Math.exp(-10 * dt));
    const pos = HIP.clone().lerp(ADS, w.ads);
    const bobAmp = player.grounded ? Math.min(moveSpeed / 6, 1.4) * (1 - w.ads * 0.85) : 0;
    pos.x += Math.cos(player.bob) * 0.012 * bobAmp + w.swayX * (1 - w.ads * 0.8);
    pos.y += Math.abs(Math.sin(player.bob)) * 0.012 * bobAmp + w.swayY * (1 - w.ads * 0.8) - w.sprintPose * 0.05;
    pos.z += w.kick * 0.045;
    let rx = w.kick * 0.06 + w.sprintPose * -0.25 + HIP_PITCH * (1 - w.ads), ry = w.sprintPose * 0.55 + HIP_YAW * (1 - w.ads), rz = w.sprintPose * 0.2;
    if (w.reloading > 0) {
      const t = 1 - w.reloading / RELOAD_T, s = Math.sin(Math.PI * t);
      pos.y -= s * 0.09; rz += s * 0.55; rx += s * 0.25;
      mag.position.copy(magHome); mag.position.y -= (t > 0.15 && t < 0.6 ? Math.sin(((t - 0.15) / 0.45) * Math.PI) : 0) * 0.22;
    } else mag.position.copy(magHome);
    rig.position.copy(pos); rig.rotation.set(rx, ry, rz);

    w.flashT -= dt;
    flash.visible = w.flashT > 0;
    if (flash.visible) { flash.material.rotation = Math.random() * 6.28; flash.scale.setScalar(0.12 + Math.random() * 0.07); }
  };

  /** Update the viewmodel camera before the post chain renders it. */
  w.prepare = (aspect) => { cam.aspect = aspect; cam.fov = 52 - w.ads * 8; cam.updateProjectionMatrix(); };
  return w;
}
