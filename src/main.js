import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { generateMaze, dailySeed } from './maze.js';
import { buildWorld } from './world.js';
import { Player, RADIUS } from './player.js';
import { createInput } from './input.js';
import { createHud, fmtTime } from './hud.js';
import { recordFinish, streak, shareText, drawCard } from './share.js';
import { createWeapon, MAG } from './weapon.js';
import { createEnemies } from './enemies.js';
import { createCrates } from './crateplay.js';
import { CRATE_KINDS } from './crates.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createPost } from './post.js';
import { createSettings } from './settings.js';
import { installUiAssets, urls } from './assets.js';
import { CFG } from './config.js';
import { setCellSize, CELL } from './world.js';
import { CHAINS, CHAIN_KEY, setChain } from './config.js';
import { chain } from './chain.js';
import { formatEther } from 'ethers';
import { scoreRun, shortestMetres } from './score.js';
import { createRunner, createThirdCam } from './runner.js';

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
const crates = createCrates(scene, world, maze, effects, audio);
// the held crate: one slot on the HUD (and a Use button on touch)
const crateEl = document.getElementById('crate'), useBtn = document.querySelector('[data-t="use"]');
crates.onChange = (k) => {
  crateEl.hidden = !k; useBtn.hidden = !k;
  if (!k) return;
  crateEl.dataset.kind = k;
  crateEl.querySelector('b').textContent = CRATE_KINDS[k].name;
  crateEl.querySelector('span').textContent = CRATE_KINDS[k].hint;
};
// the runner (third person): loads beside the game; if it can't (an embed with no /models), V just says so
// Third person is switched off until the hold is right (tune it on design/character); flip this to bring V back.
const THIRD_PERSON = false;
const runner = createRunner(scene);
if (THIRD_PERSON && location.protocol.startsWith('http')) runner.load(location.origin); else runner.failed = true;
const thirdCam = createThirdCam(world);
let view = 'first';
try { if (THIRD_PERSON && localStorage.getItem('ham.view') === 'third') view = 'third'; } catch {}
const third = () => view === 'third' && runner.ready;
let lastFire = -9, aimPose = 0;
hud.setSeed(seed);
hud.setKills(0, DRONES);
const touchUi = document.getElementById('touch');

const state = { mode: 'title', t: 0, elapsed: 0, timerOn: false, retries: 0, hp: MAX_HP, sinceHurt: 99 };
window.__maze = { maze, world, player, state, scene, camera, enemies, weapon, runner: () => runner, render: () => draw(), tick: (dt, inp) => tick(dt, inp) }; // debugging handle

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
// The first run of the day in this browser opens on an establishing shot: the camera starts high over the
// start, looking across the maze at the monolith ("Home"), then comes down into her eyes. Any key, click
// or touch skips it. Retries and later runs go straight in.
const INTRO_SECS = 3.6;
const introCap = document.createElement('div');
introCap.className = 'intro-cap'; introCap.innerHTML = '<b>Home</b><span>is the monolith. Find your way to it.</span>';
document.getElementById('app').append(introCap);
const introP0 = new THREE.Vector3(), introL0 = new THREE.Vector3(), introP = new THREE.Vector3(), introL = new THREE.Vector3();
canvas.addEventListener('pointerdown', () => { if (state.mode === 'intro') state.introSkip = true; });
function introDue() {
  try { return localStorage.getItem('ham.intro') !== String(seed); } catch { return false; }
}
function endIntro() {
  try { localStorage.setItem('ham.intro', String(seed)); } catch {}
  introCap.classList.remove('on');
  setMode('play'); hud.show(true);
  hud.message('Find the monolith', 4);
}
function startRun() {
  audio.init();
  player.reset(world.spawn, 0);
  weapon.reset(); enemies.reset(); effects.clear(); hud.reset(); input.resetTouch();
  crates.reset(); enemies.lure = null;
  hud.setKills(0, DRONES);
  state.elapsed = 0; state.timerOn = false; state.hp = MAX_HP; state.sinceHurt = 99;
  hud.setScreen(null);
  if (state.retries === 0 && introDue()) {
    // from above and behind the start, along the line to the monolith
    const g = world.goal, sp = world.spawn, dx = sp.x - g.x, dz = sp.z - g.z, d = Math.hypot(dx, dz) || 1;
    introP0.set(sp.x + (dx / d) * 6, 24, sp.z + (dz / d) * 6);
    introL0.set(g.x, 7, g.z);
    state.introT = 0; state.introSkip = false; setMode('intro'); hud.show(false);
    introCap.classList.add('on');
  } else {
    setMode('play'); hud.show(true);
    hud.message('Find the monolith', 4);
  }
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
  const run = { timeMs: Math.round(state.elapsed * 1000), walked: player.walked, kills: enemies.kills, rivals: 0, completed: true };
  const score = scoreRun(run, SHORTEST);
  const stats = { time: state.elapsed, walked: player.walked, retries: state.retries, kills: enemies.kills, acc: weapon.shots ? weapon.hits / weapon.shots : 0, score };
  lastRun = run; pendingSigned = null;
  const st = recordFinish(seed);
  lastShare = { seed, time: fmtTime(state.elapsed), kills: enemies.kills, points: score.total.toLocaleString('en-US'), walked: `${Math.round(player.walked)} m`, streakCount: st.count };
  resetShare(); showStreak();
  setTimeout(() => {
    hud.debrief(stats); hud.show(false); hud.setScreen('complete');
    if (ticket) recordRun();
    else setStatus(runStatus, CFG.practice ? 'Practice run, so this score stays here. Play for the pot from the main page to put it on-chain.' : chain.enabled() && !OFFCHAIN ? 'Practice run, so this score stays here. Play for the pot to put it on-chain.' : '');
  }, 2200);
}

// ── paid runs: pay to enter, the referee checks the finished run, the score is recorded on-chain ──
let ticket = null, lastRun = null, pendingSigned = null;
const $q = (s) => document.querySelector(s);
const OFFCHAIN = CFG.preview || CFG.practice; // admin previews and /practice never touch the chain
const potBox = $q('.m-pot'), potBtn = $q('[data-act="play-pot"]'), practiceBtn = $q('[data-act="deploy"]');
const powerupBox = $q('.m-powerup'), powerupK = $q('.m-powerup-k'), mintBtn = $q('[data-act="mint-powerup"]');
const repeatNote = $q('.m-repeat');
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
for (const [k, c] of Object.entries(CHAINS)) if (!c.dev || k === CHAIN_KEY) chainSel.add(new Option(c.name + (c.contract ? '' : ' (soon)'), k, false, k === CHAIN_KEY));
chainSel.addEventListener('change', () => setChain(chainSel.value));
potBox.hidden = OFFCHAIN;
if (CFG.practice) {
  // the practice page: same maze, no pot, no wallet
  $q('.m-no').insertAdjacentHTML('afterbegin', '<b class="m-practice">Practice</b> ');
  practiceBtn.textContent = 'Start practice';
  $q('[data-practice-link]').hidden = true; $q('[data-pot-link]').hidden = false;
}

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
  refreshRepeat();
  chain.streak().then((st) => { chainStreak = st; showStreak(); });
}

// Repeat runs: say what the next paid run counts for before anyone pays for it. Only where the
// contract has the rule (nextRun is null otherwise) and a wallet is connected.
const repeatLine = (n) => n.run > 1
  ? `Run ${n.run} today: your points count at <b>${n.pct}%</b>. Every run after your first keeps 8% less, down to 60%.`
  : 'Your first run today counts in full. Every run after it keeps 8% less, down to 60%.';
async function refreshRepeat() {
  const n = await chain.nextRun();
  repeatNote.hidden = !n;
  if (n) repeatNote.innerHTML = repeatLine(n);
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
if (chain.enabled() && !OFFCHAIN) {
  potBtn.hidden = false; practiceBtn.classList.remove('primary'); practiceBtn.textContent = 'Practice run';
  refreshPot();
} else if (!OFFCHAIN) refreshPot();

async function recordRun() {
  retrySubmit.hidden = true;
  try {
    if (!pendingSigned) { setStatus(runStatus, 'Checking your run with the referee…'); pendingSigned = await chain.check(ticket, lastRun); }
    if (ticket.payAfter) {
      // HamRobinhood: this one call pays the fee (or uses a holder's free run), mints the Score and ranks it
      const fee = await chain.feeNow();
      const pay = fee > 0n ? `pay ${formatEther(fee)} ETH and record` : 'record (your free holder run)';
      setStatus(runStatus, `The referee signed ${pendingSigned.points.toLocaleString('en-US')} points. Confirm in your wallet to ${pay} them on ${chain.info.name}…`);
      const out = await chain.playRun(pendingSigned);
      const counted = out.boosted === pendingSigned.points ? ''
        : ` (counts as ${out.boosted.toLocaleString('en-US')}${out.boosted < pendingSigned.points ? `: run ${pendingSigned.attempt + 1} today keeps less` : ' with your boost'})`;
      setStatus(runStatus, `Recorded on ${chain.info.name}: ${pendingSigned.points.toLocaleString('en-US')} points${counted}. Your Score is No. ${out.tokenId}.`, 'ok');
      ticket = null; pendingSigned = null; potBtn.textContent = 'Play for the pot'; refreshPot();
      return;
    }
    setStatus(runStatus, `The referee signed ${pendingSigned.points.toLocaleString('en-US')} points. Confirm in your wallet to record them on ${chain.info.name}…`);
    const out = await chain.submit(pendingSigned);
    const boosted = out.boosted > pendingSigned.points ? ` (boosted to ${out.boosted.toLocaleString('en-US')})`
      : out.boosted < pendingSigned.points ? ` (counts as ${out.boosted.toLocaleString('en-US')}: run ${pendingSigned.attempt + 1} today keeps less)` : '';
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
    const next = await chain.nextRun();
    if (next) repeatNote.innerHTML = repeatLine(next), repeatNote.hidden = false;
    if (chain.payAfter()) {
      // HamRobinhood: nothing to pay yet. Play first; reaching the monolith offers to pay and record the run.
      ticket = await chain.ticketForLater();
      setStatus(titleStatus, `${next && next.run > 1 ? `Run ${next.run} today, so your points count at ${next.pct}%. ` : ''}You pay when you record the run, after you reach the monolith.`, 'ok');
      state.retries = 0; startRun();
      return;
    }
    setStatus(titleStatus, `${next && next.run > 1 ? `Run ${next.run} today, so your points count at ${next.pct}%. ` : ''}Confirm the entry in your wallet…`);
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
hud.on('again', () => { if (chain.enabled() && !OFFCHAIN) { toTitle(); refreshPot(); } else { state.retries = 0; startRun(); } });
hud.on('quit', toTitle);
hud.on('settings', () => settings.open('settings'));
hud.on('controls', () => settings.open('controls'));
addEventListener('keydown', (e) => { if (e.code === 'Enter' && state.mode === 'title') { state.retries = 0; startRun(); } });

// ---- combat wiring ----
weapon.onShoot = (origin, dir, muzzle) => {
  lastFire = state.t;
  if (third()) muzzle = runner.muzzle();
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

// ---- streak on the title, and the share card on the debrief ----
let lastShare = null, shareUrl = null;
const streakEl = document.querySelector('.m-streak'), shareBox = document.querySelector('.m-share'),
  shareImg = document.querySelector('.m-share-img'), shareLinks = document.querySelector('.m-share-links'),
  shareX = document.querySelector('[data-share-x]'), shareSave = document.querySelector('[data-share-save]'),
  shareBtn = document.querySelector('[data-act="share"]');
// The streak shown is the chain's when a wallet is connected to a contract that keeps one (that's the one that
// pays the HAM Points bonus), else this browser's own count.
let chainStreak = null;
function showStreak() {
  const s = chainStreak || streak(seed);
  streakEl.hidden = s.count < 2 && !(s.count === 1 && !s.today);
  if (streakEl.hidden) return;
  const bonus = chainStreak && chainStreak.bonusPct ? ` · +${chainStreak.bonusPct}% HAM Points` : '';
  streakEl.textContent = (s.today ? `Day ${s.count} in a row` : `${s.count}-day streak: play today to keep it`) + bonus;
  streakEl.classList.toggle('due', !s.today);
}
showStreak();
function resetShare() {
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareUrl = null; shareBox.hidden = true; shareImg.hidden = true; shareLinks.hidden = true;
  shareBtn.disabled = false; shareBtn.textContent = 'Share your run';
}
/** A frame of the maze from the title screen's orbit: the view everyone already sees, so no route is given away. */
function orbitFrame() {
  const pos = camera.position.clone(), quat = camera.quaternion.clone(), mode = state.mode;
  const a = 0.6, g = world.goal, R = HALF * 0.72;
  camera.position.set(g.x + Math.cos(a) * R, 10.5, g.z + Math.sin(a) * R);
  camera.lookAt(g.x, 9, g.z);
  state.mode = 'title';
  let url = null;
  try { draw(); url = renderer.domElement.toDataURL('image/jpeg', 0.9); } catch { url = null; }
  state.mode = mode; camera.position.copy(pos); camera.quaternion.copy(quat);
  draw();
  return url;
}
hud.on('share', async () => {
  if (!lastShare) return;
  shareBtn.disabled = true; shareBtn.textContent = 'Making your card…';
  const text = shareText(lastShare);
  let blob = null;
  try { blob = await drawCard({ ...lastShare, plate: orbitFrame() }); } catch { blob = null; }
  const file = blob && new File([blob], `ham-${lastShare.seed}.png`, { type: 'image/png' });
  // phones: the system share sheet, with the image
  if (file && navigator.canShare && navigator.canShare({ files: [file], text })) {
    try { await navigator.share({ files: [file], text }); shareBtn.disabled = false; shareBtn.textContent = 'Share again'; return; } catch { /* closed: fall through to the card */ }
  }
  if (blob) {
    if (shareUrl) URL.revokeObjectURL(shareUrl);
    shareUrl = URL.createObjectURL(blob);
    shareImg.src = shareUrl; shareImg.hidden = false; shareSave.href = shareUrl; shareSave.download = `ham-${lastShare.seed}.png`;
  }
  shareX.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  shareLinks.hidden = false; shareBox.hidden = false;
  try { await navigator.clipboard.writeText(text); shareBtn.textContent = 'Text copied. Save the image and post it'; } catch { shareBtn.textContent = 'Save the image and post it'; }
  shareBtn.disabled = false;
});

const clock = new THREE.Clock();
const goalVec = new THREE.Vector3(), eye = new THREE.Vector3();

let lastDt = 1 / 60;
function draw() {
  weapon.prepare(camera.aspect);
  const inRun = state.mode === 'play' || state.mode === 'paused';
  runner.setVisible(third() && state.mode !== 'title');
  post.render(lastDt, { showGun: inRun && !third(), hurt: inRun ? hud.hurtLevel : 0, lowHp: inRun ? hud.lowHp : 0, ads: inRun ? weapon.ads : 0 });
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
      if (THIRD_PERSON && inp.pressed.has('KeyV')) {
        if (runner.ready) {
          view = view === 'third' ? 'first' : 'third';
          try { localStorage.setItem('ham.view', view); } catch {}
          hud.message(view === 'third' ? 'Third person' : 'First person', 1.2);
        } else hud.message(runner.failed ? 'Third person isn’t available here' : 'The runner is still loading', 1.6);
      }
      if (third()) {
        thirdCam(camera, player, weapon.ads, dt);
        aimPose += (Math.max(weapon.ads, state.t - lastFire < 0.9 || inp.fire ? 1 : 0) - aimPose) * (1 - Math.exp(-12 * dt));
        runner.update(dt, { pos: player.pos, vel: player.vel, yaw: player.yaw, pitch: player.pitch, speed: moveSpeed, air: !player.grounded, crouch: (1.6 - player.eye) / 0.6, aim: aimPose, kick: weapon.kick, flash: weapon.flashT > 0 });
      }
      audio.setListener(player.pos.x, player.pos.z, player.yaw);
      audio.step(dt, moveSpeed, player.grounded);

      if (!state.timerOn && player.distFromSpawn() >= 1) state.timerOn = true; // Unity: moveDistanceThreshold = 1
      if (state.timerOn) state.elapsed += dt;
      state.sinceHurt += dt;
      if (state.sinceHurt > REGEN_DELAY && state.hp < MAX_HP) state.hp = Math.min(MAX_HP, state.hp + REGEN_RATE * dt);
      // crates: walk into one to pick it up (one at a time), Q to use it
      const got = crates.update(dt, state.t, player, true);
      if (got) hud.message(`${CRATE_KINDS[got].name}: press ${input.touch ? 'Use' : 'Q'}`, 3);
      if (inp.pressed.has('KeyQ')) crates.use(player);
      enemies.lure = crates.lure;
      if (world.reachedGoal(player.pos, RADIUS)) complete();
    }
  } else if (state.mode === 'intro') {
    state.introT += dt;
    const k = Math.min(1, state.introT / INTRO_SECS);
    // hold on the monolith for the first third, then ease down into her eyes, facing where she faces
    const e = THREE.MathUtils.smootherstep(k, 0.3, 1);
    eye.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
    introP.lerpVectors(introP0, eye, e);
    introL.set(eye.x - Math.sin(player.yaw), eye.y, eye.z - Math.cos(player.yaw)).lerp(introL0, 1 - e);
    camera.position.copy(introP); camera.lookAt(introL);
    if (state.introT > 2.4) introCap.classList.remove('on');
    if (third()) runner.update(dt, { pos: player.pos, vel: player.vel, yaw: player.yaw, pitch: 0, speed: 0, air: false, crouch: 0, aim: 0, kick: 0, flash: false });
    if (k >= 1 || inp.pressed.size || state.introSkip) {
      endIntro();
      if (inp.pressed.has('Escape') || inp.pressed.has('KeyP')) pause();
    }
  } else if (state.mode === 'title') {
    // slow orbit just above the walls, the monolith against the sky, framed right of the title panel
    const a = state.t * 0.04, g = world.goal, R = HALF * 0.72;
    camera.position.set(g.x + Math.cos(a) * R, 10.5 + Math.sin(state.t * 0.13) * 1.2, g.z + Math.sin(a) * R);
    const shift = innerWidth > 760 ? Math.min(0.42, 460 / innerWidth) * 11 : 0; // aim left of the pillar so it sits in the open area
    camera.lookAt(g.x - Math.sin(a) * shift, 11, g.z + Math.cos(a) * shift);
  }

  if (state.mode !== 'play') crates.update(dt, state.t, player, false);
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
