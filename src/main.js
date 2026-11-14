import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { generateMaze, dailySeed } from './maze.js';
import { buildWorld } from './world.js';
import { Player, RADIUS } from './player.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createWeapon, MAG } from './weapon.js';
import { createEnemies } from './enemies.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createPost } from './post.js';
import { createSettings } from './settings.js';
import { installUiAssets, urls } from './assets.js';
import { CFG } from './config.js';
import { setCellSize, CELL } from './world.js';
import { CHAINS, CHAIN_KEY, setChain } from './config.js';
import { chain } from './chain.js';
import { scoreRun, shortestMetres } from './score.js';

// Size and difficulty come from the admin settings (defaults match the Unity scene: 12 x 12 cells of 7 m, 8 sentries).
const MAZE_W = CFG.mazeSize, MAZE_D = CFG.mazeSize, DRONES = CFG.sentries;
const DMG_BODY = 20, DMG_CRIT = 45, MAX_HP = CFG.playerHealth, REGEN_DELAY = 4.5, REGEN_RATE = 22;
setCellSize(CFG.cellSize);
const HALF = MAZE_W * CELL / 2; // centre to edge

installUiAssets();

// The original game's soundtrack, looping softly under everything (starts on the first click or key).
const music = new Audio(urls.music);
music.loop = true; music.preload = 'auto';
let musicLevel = 0.6, musicOn = false, musicMix = 0.7;
function startMusic() { if (musicOn) return; musicOn = true; music.volume = musicLevel * musicMix; music.play().catch(() => { musicOn = false; }); }
for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, startMusic, { passive: true });

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, 1, 0.05, 1200);
camera.rotation.order = 'YXZ';

// soft studio reflections so metal (gun, drones) is not black; kept low so the dusk light still leads
const envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envMap; scene.environmentIntensity = 0.12;

const seed = dailySeed();
const maze = generateMaze(MAZE_W, MAZE_D, seed, CFG.loops);
const world = buildWorld(scene, maze);
const SHORTEST = shortestMetres(maze, CELL); // metres from spawn to the monolith, for the route score
const effects = createEffects(scene);
const audio = createAudio();
const input = createInput(canvas);
const player = new Player(camera, world);
const weapon = createWeapon(envMap);
const enemies = createEnemies(scene, world, maze, effects, audio, { count: DRONES });
const hud = createHud({ magSize: CFG.magSize });
hud.setSeed(seed);
hud.setKills(0, DRONES);
const touchUi = document.getElementById('touch');

const state = { mode: 'title', t: 0, elapsed: 0, timerOn: false, retries: 0, hp: MAX_HP, sinceHurt: 99 };
window.__maze = { maze, world, player, state, scene, camera, enemies, weapon, render: () => draw(), tick: (dt, inp) => tick(dt, inp) }; // debugging handle

const settings = createSettings({ touch: input.touch });
const post = createPost(renderer, scene, camera, weapon);

function resize() {
  const w = innerWidth, h = innerHeight, q = settings.get().quality, dpr = devicePixelRatio || 1;
  const pr = q === 'low' ? Math.min(dpr, 1) * 0.85 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  post.resize(w, h, pr);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
settings.onChange((s) => {
  input.sensitivity = s.sensitivity; input.invertY = s.invertY;
  audio.setVolume(s.volume / 100);
  musicLevel = Math.min(1, (s.music ?? 60) / 100); music.volume = musicLevel * musicMix;
  if (musicLevel === 0) music.pause(); else if (musicOn && music.paused) music.play().catch(() => {});
  player.fovSetting = s.fov;
  post.setQuality(s.quality);
  world.setShadows(s.quality === 'low' ? 0 : s.quality === 'medium' ? 1024 : 2048);
  resize();
});

function setMode(m) {
  state.mode = m;
  input.enabled = m === 'play';
  touchUi.classList.toggle('idle', m !== 'play');
}
function startRun() {
  audio.init();
  player.reset(world.spawn, 0);
  weapon.reset(); enemies.reset(); effects.clear(); hud.reset(); input.resetTouch();
  hud.setKills(0, DRONES);
  state.elapsed = 0; state.timerOn = false; state.hp = MAX_HP; state.sinceHurt = 99;
  setMode('play');
  hud.setScreen(null); hud.show(true);
  hud.message('Find the monolith', 4);
  input.lock(); canvas.focus();
}
function pause() {
  if (state.mode !== 'play') return;
  setMode('paused'); input.unlock();
  hud.setScreen('paused');
}
function resume() {
  audio.init();
  setMode('play');
  hud.setScreen(null); input.lock(); canvas.focus();
}
function complete() {
  setMode('complete'); state.timerOn = false; input.unlock();
  audio.win(); world.celebrate();
  const run = { timeMs: Math.round(state.elapsed * 1000), walked: player.walked, kills: enemies.kills, rivals: 0 };
  const score = scoreRun(run, SHORTEST);
  const stats = { time: state.elapsed, walked: player.walked, retries: state.retries, kills: enemies.kills, acc: weapon.shots ? weapon.hits / weapon.shots : 0, score };
  lastRun = run; pendingSigned = null;
  setTimeout(() => {
    hud.debrief(stats); hud.show(false); hud.setScreen('complete');
    if (ticket) recordRun();
    else setStatus(runStatus, chain.enabled() && !CFG.preview ? 'Practice run, so this score stays here. Play for the pot to put it on-chain.' : '');
  }, 2200);
}

// ── paid runs: pay to enter, the referee checks the finished run, the score is recorded on-chain ──
let ticket = null, lastRun = null, pendingSigned = null;
const $q = (s) => document.querySelector(s);
const potBox = $q('.m-pot'), potBtn = $q('[data-act="play-pot"]'), practiceBtn = $q('[data-act="deploy"]');
const powerupBox = $q('.m-powerup'), powerupK = $q('.m-powerup-k'), mintBtn = $q('[data-act="mint-powerup"]');
const titleStatus = $q('.m-title-status'), runStatus = $q('.m-run-status'), retrySubmit = $q('[data-act="submit-run"]');
const setStatus = (el, msg, kind = '') => { el.textContent = msg; el.dataset.kind = kind; };
const errText = (e) => {
  if (e?.code === 'ACTION_REJECTED' || e?.code === 4001) return 'You cancelled it in your wallet.';
  const raw = e?.shortMessage || e?.reason || e?.message || String(e);
  // "missing revert data" / "insufficient funds" / OutOfFund: the wallet has no reason string for this, but
  // it almost always means the connected wallet does not have enough ETH to cover the fee plus gas.
  if (/missing revert data|insufficient funds|outoffund/i.test(raw)) {
    return `Your wallet doesn't have enough ${chain.info.testnet ? 'testnet ' : ''}ETH for this (the fee plus gas).${chain.info.testnet ? ' Get more from the Aurora faucet: aurora.dev/faucet' : ''}`;
  }
  return raw;
};

const chainSel = $q('.m-chain');
for (const [k, c] of Object.entries(CHAINS)) chainSel.add(new Option(c.name + (c.contract ? '' : ' (soon)'), k, false, k === CHAIN_KEY));
chainSel.addEventListener('change', () => setChain(chainSel.value));
potBox.hidden = CFG.preview;

async function refreshPot() {
  const v = potBox.querySelector('.m-pot-v'), list = potBox.querySelector('.m-podium');
  if (!chain.enabled()) { v.textContent = 'Not live yet'; list.innerHTML = ''; return; }
  try {
    const t = await chain.today();
    v.textContent = `${Number(t.pot).toFixed(4)} ETH`;
    list.innerHTML = t.top.length
      ? t.top.map((p, i) => `<li><span>${i + 1}. ${chain.short(p.who)}</span><span>${p.points.toLocaleString('en-US')} pts</span></li>`).join('')
      : `<li><span>No scores yet today. ${t.entries} run${t.entries === 1 ? '' : 's'} so far.</span></li>`;
    potBtn.textContent = `Play for the pot · ${Number(t.fee)} ETH`;
  } catch { v.textContent = 'Could not reach the chain'; }
  refreshPowerup();
}

async function refreshPowerup() {
  if (!chain.powerupEnabled()) { powerupBox.hidden = true; return; }
  powerupBox.hidden = false;
  try {
    const owned = chain.account ? await chain.powerupOwned(chain.account) : false;
    if (owned) { powerupK.textContent = 'You hold the power-up NFT. It boosts your points.'; mintBtn.hidden = true; return; }
    mintBtn.hidden = false; mintBtn.disabled = false; mintBtn.textContent = 'Mint free';
    const { total, max } = await chain.powerupSupply();
    powerupK.textContent = total >= max
      ? 'The power-up NFT has sold out.'
      : `Free power-up NFT: boosts your points (${total.toLocaleString('en-US')}/${max.toLocaleString('en-US')} minted).`;
    mintBtn.hidden = total >= max;
  } catch { powerupK.textContent = 'Power-up NFT: could not reach the chain.'; mintBtn.hidden = true; }
}
hud.on('mint-powerup', async () => {
  mintBtn.disabled = true; mintBtn.textContent = 'Minting…';
  try {
    await chain.mintPowerup();
    await refreshPowerup();
  } catch (e) {
    powerupK.textContent = errText(e);
    mintBtn.disabled = false; mintBtn.textContent = 'Mint free';
  }
});
if (chain.enabled() && !CFG.preview) {
  potBtn.hidden = false; practiceBtn.classList.remove('primary'); practiceBtn.textContent = 'Practice run';
  refreshPot();
} else refreshPot();

async function recordRun() {
  retrySubmit.hidden = true;
  try {
    if (!pendingSigned) { setStatus(runStatus, 'Checking your run with the referee…'); pendingSigned = await chain.check(ticket, lastRun); }
    setStatus(runStatus, `The referee signed ${pendingSigned.points.toLocaleString('en-US')} points. Confirm in your wallet to record them on ${chain.info.name}…`);
    const out = await chain.submit(pendingSigned);
    const boosted = out.boosted > pendingSigned.points ? ` (boosted to ${out.boosted.toLocaleString('en-US')})` : '';
    setStatus(runStatus, `Recorded on ${chain.info.name}: ${pendingSigned.points.toLocaleString('en-US')} points${boosted}. ${out.best ? 'That is your best today.' : 'Your best today is still higher.'}`, 'ok');
    ticket = null; pendingSigned = null; refreshPot();
  } catch (e) {
    setStatus(runStatus, errText(e), 'bad');
    retrySubmit.hidden = !/wallet|network|timeout|fetch|referee answered 5/i.test(errText(e)) && !pendingSigned;
  }
}
hud.on('submit-run', () => { if (ticket && lastRun) recordRun(); });
hud.on('play-pot', async () => {
  if (ticket) { state.retries = 0; startRun(); return; } // paid already, run not finished yet
  potBtn.disabled = true;
  try {
    setStatus(titleStatus, 'Connect your wallet…');
    await chain.connect();
    setStatus(titleStatus, 'Confirm the entry in your wallet…');
    ticket = await chain.enter();
    setStatus(titleStatus, `Paid. This is your run ${ticket.attempt + 1} today; retries are free until you reach the monolith.`, 'ok');
    potBtn.textContent = 'Continue your paid run';
    state.retries = 0; startRun();
  } catch (e) { setStatus(titleStatus, errText(e), 'bad'); }
  finally { potBtn.disabled = false; }
});
function die() {
  setMode('dead'); input.unlock();
  hud.dead({ time: state.elapsed, kills: enemies.kills });
  hud.show(false); hud.setScreen('dead');
}
function toTitle() { setMode('title'); hud.show(false); hud.setScreen('title'); }

input.onUnlock = () => { if (state.mode === 'play') pause(); };
input.onPause = pause;
hud.on('deploy', () => { state.retries = 0; startRun(); });
hud.on('resume', resume);
hud.on('restart', () => { state.retries++; startRun(); });
hud.on('retry', () => { state.retries++; startRun(); });
hud.on('again', () => { if (chain.enabled() && !CFG.preview) { toTitle(); refreshPot(); } else { state.retries = 0; startRun(); } });
hud.on('quit', toTitle);
hud.on('settings', () => settings.open('settings'));
hud.on('controls', () => settings.open('controls'));
addEventListener('keydown', (e) => { if (e.code === 'Enter' && state.mode === 'title') { state.retries = 0; startRun(); } });

// ---- combat wiring ----
weapon.onShoot = (origin, dir, muzzle) => {
  audio.shot();
  effects.flash(muzzle);
  const wall = world.raycast(origin, dir, 250);
  const maxT = wall ? wall.t : 250;
  const hit = enemies.raycast(origin, dir, maxT);
  let end;
  if (hit) {
    end = hit.point;
    weapon.hits++;
    const killed = enemies.damage(hit.drone, hit.crit ? DMG_CRIT : DMG_BODY, player.pos.clone());
    effects.sparks(hit.point, dir.clone().negate(), hit.crit ? 22 : 12, hit.crit ? 0xffd070 : 0xffa040, 5);
    hud.hit(killed ? 'kill' : hit.crit ? 'crit' : '');
    audio.hit(hit.crit);
    if (killed) hud.setKills(enemies.kills, DRONES);
  } else if (wall) {
    end = wall.point;
    effects.hole(wall.point, wall.normal);
    effects.sparks(wall.point, wall.normal, 6, 0xffc080, 3.5);
    effects.sparks(wall.point, wall.normal, 5, 0x6a6258, 2); // concrete dust
  } else end = origin.clone().addScaledVector(dir, 250);
  if (Math.random() < 0.5) effects.tracer(muzzle, end);
  enemies.hearShot(origin, 34);
};
weapon.onEmpty = () => audio.empty();
weapon.onReload = () => audio.reload();
enemies.onPlayerHit = (dmg, from) => {
  if (state.mode !== 'play') return;
  state.hp -= dmg; state.sinceHurt = 0;
  audio.hurt();
  const srcYaw = Math.atan2(-(from.x - player.pos.x), -(from.z - player.pos.z));
  hud.damage(((srcYaw - player.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI, dmg);
  if (state.hp <= 0) { state.hp = 0; die(); }
};

const clock = new THREE.Clock();
const goalVec = new THREE.Vector3(), eye = new THREE.Vector3();

let lastDt = 1 / 60;
function draw() {
  weapon.prepare(camera.aspect);
  const inRun = state.mode === 'play' || state.mode === 'paused';
  post.render(lastDt, { showGun: inRun, hurt: inRun ? hud.hurtLevel : 0, lowHp: inRun ? hud.lowHp : 0, ads: inRun ? weapon.ads : 0 });
}

// If play runs slow (average frame over ~2 s above 24 ms), step quality down once per level and say so.
const perf = { n: 0, sum: 0, warm: 0 };
function watchPerf(raw) {
  if (state.mode !== 'play' || document.hidden) { perf.n = perf.sum = 0; perf.warm = 0; return; }
  if ((perf.warm += raw) < 2) return; // ignore shader warm-up after entering
  perf.n++; perf.sum += raw;
  if (perf.n < 120) return;
  const avg = perf.sum / perf.n; perf.n = perf.sum = 0;
  const { quality: q, autoQuality } = settings.get();
  if (autoQuality && avg > 0.024 && q !== 'low') {
    const next = q === 'high' ? 'medium' : 'low';
    settings.set({ quality: next });
    hud.message(`Graphics set to ${next} for smoother play (change in Settings)`, 4);
  }
}

function frame() {
  requestAnimationFrame(frame);
  const raw = clock.getDelta();
  watchPerf(raw);
  tick(Math.min(raw, 0.05), input.consume());
}

function tick(dt, inp) {
  state.t += dt; lastDt = dt;
  if (state.mode === 'play') {
    if (inp.pressed.has('Escape') || inp.pressed.has('KeyP')) pause();
    else {
      // aiming slows you and the look; firing or aiming cancels sprint
      if (inp.ads || inp.fire) inp.sprint = false;
      const ads = weapon.ads;
      inp.look.dx *= 1 - ads * 0.45; inp.look.dy *= 1 - ads * 0.45;
      inp.speedScale = 1 - ads * 0.45;
      const yaw0 = player.yaw;
      player.baseFov = (player.fovSetting || 78) * (1 - ads * 0.28);
      player.update(dt, inp);
      hud.rotateArcs(player.yaw - yaw0);
      const moveSpeed = Math.hypot(player.vel.x, player.vel.z);
      weapon.update(dt, { inp, player, camera, sprinting: player.sprinting, moveSpeed });
      audio.setListener(player.pos.x, player.pos.z, player.yaw);
      audio.step(dt, moveSpeed, player.grounded);

      if (!state.timerOn && player.distFromSpawn() >= 1) state.timerOn = true; // Unity: moveDistanceThreshold = 1
      if (state.timerOn) state.elapsed += dt;
      state.sinceHurt += dt;
      if (state.sinceHurt > REGEN_DELAY && state.hp < MAX_HP) state.hp = Math.min(MAX_HP, state.hp + REGEN_RATE * dt);
      if (world.reachedGoal(player.pos, RADIUS)) complete();
    }
  } else if (state.mode === 'title') {
    // slow orbit just above the walls, the monolith against the sky, framed right of the title panel
    const a = state.t * 0.04, g = world.goal, R = HALF * 0.72;
    camera.position.set(g.x + Math.cos(a) * R, 10.5 + Math.sin(state.t * 0.13) * 1.2, g.z + Math.sin(a) * R);
    const shift = innerWidth > 760 ? Math.min(0.42, 460 / innerWidth) * 11 : 0; // aim left of the pillar so it sits in the open area
    camera.lookAt(g.x - Math.sin(a) * shift, 11, g.z + Math.cos(a) * shift);
  }

  const live = state.mode === 'play';
  eye.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
  if (state.mode !== 'paused') {
    enemies.update(live ? dt : dt * 0.5, player, eye, live);
    effects.update(dt, camera.position);
  }
  world.update(dt, state.t, camera);
  // music swells as you close in on the monolith: a quarter volume at the far corners, full at the foot of it
  if (musicOn) {
    const d = Math.hypot(camera.position.x - world.goal.x, camera.position.z - world.goal.z);
    const near = state.mode === 'play' || state.mode === 'paused' ? 1 - Math.min(1, d / (HALF * 1.42)) : 0.7;
    musicMix += (0.25 + 0.75 * near * near - musicMix) * Math.min(1, dt * 1.5);
    music.volume = Math.min(1, musicLevel * musicMix);
  }

  if (state.mode === 'play' || state.mode === 'paused') {
    goalVec.copy(world.goal).sub(player.pos);
    hud.update(dt, {
      heading: (-player.yaw * 180) / Math.PI,
      goalBearing: (Math.atan2(goalVec.x, -goalVec.z) * 180) / Math.PI,
      goalDist: Math.max(0, Math.hypot(goalVec.x, goalVec.z) - 1.5),
      elapsed: state.elapsed, timerOn: state.timerOn,
      spread: weapon.spread * (1 - weapon.ads) + weapon.bloom, ads: weapon.ads, sprinting: player.sprinting,
      mag: weapon.mag, reserve: weapon.reserve, reloading: weapon.reloading > 0, hp: state.hp,
    });
  }
  draw();
}
frame();
