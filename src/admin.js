// HAM admin page. Sign in with a wallet (a free signature, checked against the contract's owner), then edit the
// game settings and economy stored in HamDailyRun. Every write is an owner-only transaction, so the contract is the
// real gate; the sign-in just keeps the page closed to everyone else.
import { BrowserProvider, JsonRpcProvider, Contract, formatEther, parseEther, formatUnits, parseUnits, verifyMessage, isAddress, getAddress, ZeroAddress } from 'ethers';
import { CHAIN, CHAINS, CHAIN_KEY, setChain, FIELDS, DEFAULTS } from './config.js';
import { generateMaze, dailySeed } from './maze.js';

const CFG_T = 'tuple(uint8 mazeSize,uint8 cellSize,uint8 sentries,uint8 sentryHealth,uint8 sentryDamage,uint8 playerHealth,uint8 magSize,uint8 loops)';
const ABI = [
  'function owner() view returns (address)', 'function referee() view returns (address)', 'function treasury() view returns (address)',
  'function holderToken() view returns (address)', 'function entryFee() view returns (uint256)', 'function paused() view returns (bool)',
  'function treasuryOwed() view returns (uint256)', 'function currentDay() view returns (uint256)', 'function nextConfigDay() view returns (uint256)',
  `function configFor(uint256) view returns (${CFG_T})`,
  'function dayInfo(uint256) view returns (uint256 pot, uint256 unclaimed, uint256 settledAt, uint256 entryCount, address[3] top, uint32[3] topPoints, uint32[3] topTime)',
  'function boosters() view returns (tuple(address token, uint96 minBalance, uint16 bps)[])',
  'function setBoosters(tuple(address token, uint96 minBalance, uint16 bps)[] list)',
  `function setConfig(${CFG_T} config_, bool immediate)`, 'function setEntryFee(uint256)', 'function setPaused(bool)',
  'function setHolderToken(address)', 'function setReferee(address)', 'function setTreasury(address)',
  'function settle(uint256)', 'function withdrawTreasury()',
];
const CHAIN_HEX = '0x' + CHAIN.id.toString(16);
const SESSION_KEY = 'ham.admin.session', CONTRACT_KEY = 'ham.admin.contract.' + CHAIN_KEY;
const TOKEN_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'];
const $ = (id) => document.getElementById(id);
const store = { get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch {} } };

let provider = null, signer = null, account = null, owner = null;
let contractAddr = store.get(CONTRACT_KEY) || CHAIN.contract;
const read = () => (isAddress(contractAddr) ? new Contract(contractAddr, ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true })) : null);
const write = () => (isAddress(contractAddr) && signer ? new Contract(contractAddr, ABI, signer) : null);
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '-');
const say = (el, msg, kind = '') => { el.textContent = msg; el.className = 'status ' + kind; };

// ── wallet ──────────────────────────────────────────────────────────────────
async function connect() {
  if (!window.ethereum) throw new Error('No wallet found. Install a browser wallet such as MetaMask or Rabby.');
  provider = new BrowserProvider(window.ethereum, 'any');
  [account] = await provider.send('eth_requestAccounts', []);
  account = getAddress(account);
  try { await provider.send('wallet_switchEthereumChain', [{ chainId: CHAIN_HEX }]); }
  catch (e) {
    if (e?.error?.code === 4902 || e?.code === 4902 || /unrecognized|not added/i.test(e?.message || '')) {
      await provider.send('wallet_addEthereumChain', [{ chainId: CHAIN_HEX, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [CHAIN.explorer] }]);
    } else throw e;
  }
  provider = new BrowserProvider(window.ethereum, 'any');
  signer = await provider.getSigner();
  $('walletBtn').textContent = short(account);
  $('netPill').textContent = 'Robinhood Chain'; $('netPill').classList.add('on');
}

async function signIn() {
  const gs = $('gateStatus');
  try {
    say(gs, 'Waiting for your wallet…');
    await connect();
    const issued = new Date().toISOString();
    const nonce = crypto.getRandomValues(new Uint32Array(2)).join('');
    const message = `HAM admin sign-in\n\nAddress: ${account}\nContract: ${contractAddr || 'not deployed'}\nChain: ${CHAIN.id}\nIssued: ${issued}\nNonce: ${nonce}\n\nThis signature costs nothing and does not send a transaction.`;
    say(gs, 'Sign the message in your wallet…');
    const sig = await signer.signMessage(message);
    if (verifyMessage(message, sig) !== account) throw new Error('The signature does not match this wallet.');
    owner = await readOwner();
    if (owner && owner !== account) throw new Error(`This wallet is not the owner. The owner is ${short(owner)}.`);
    store.set(SESSION_KEY, JSON.stringify({ account, until: Date.now() + 12 * 3600e3 }), sessionStorage);
    open();
  } catch (e) { say(gs, e.shortMessage || e.message || String(e), 'bad'); }
}

async function readOwner() {
  const c = read();
  if (!c) return null; // not deployed yet: settings can be designed and previewed, not saved
  try { return getAddress(await c.owner()); } catch { return null; }
}

function open() {
  $('gate').hidden = true; $('app').hidden = false;
  $('contractNote').textContent = isAddress(contractAddr)
    ? (owner ? `Owner ${short(owner)}. You are signed in as the owner.` : 'Could not read the owner from this address.')
    : 'No contract yet. Deploy HamDailyRun, paste its address here, and the settings below can be saved on-chain. Until then you can design and preview them.';
  $('contractIn').value = contractAddr || '';
  refresh();
}

// ── settings form ───────────────────────────────────────────────────────────
const values = { ...DEFAULTS };
function buildFields() {
  $('fields').innerHTML = FIELDS.map((f) => `
    <div class="row"><label class="label" for="f-${f.key}">${f.label}</label>
      <input type="range" id="f-${f.key}" min="${f.min}" max="${f.max}" step="1" value="${values[f.key]}">
      <input type="number" id="n-${f.key}" min="${f.min}" max="${f.max}" step="1" value="${values[f.key]}" aria-label="${f.label} (${f.unit})"></div>`).join('');
  for (const f of FIELDS) {
    const r = $('f-' + f.key), n = $('n-' + f.key);
    const set = (v) => { v = Math.max(f.min, Math.min(f.max, Math.round(Number(v) || f.min))); values[f.key] = v; r.value = v; n.value = v; draw(); };
    r.addEventListener('input', () => set(r.value));
    n.addEventListener('change', () => set(n.value));
  }
}
const when = () => document.querySelector('input[name=when]:checked').value;
document.querySelectorAll('input[name=when]').forEach((r) => r.addEventListener('change', draw));
function setValues(c) { for (const f of FIELDS) values[f.key] = Number(c[f.key]); buildFields(); draw(); }

// ── maze preview (same generator as the game) ─────────────────────────────────
function draw() {
  const now = new Date(), seedDate = when() === 'tomorrow' ? new Date(now.getTime() + 86400e3) : now;
  const seed = dailySeed(seedDate), N = values.mazeSize;
  const maze = generateMaze(N, N, seed, values.loops);
  $('prevSeed').textContent = `Maze No. ${seed}`;
  const q = new URLSearchParams({ preview: '' }); for (const f of FIELDS) q.set(f.key, values[f.key]);
  $('previewLink').href = '/?' + q.toString().replace('preview=', 'preview');

  const cv = $('map'), g = cv.getContext('2d'), W = cv.width, pad = 30, s = (W - pad * 2) / N;
  g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, W, W);
  const X = (x) => pad + x * s, Y = (z) => W - pad - z * s; // z grows upward like the game's map
  g.lineCap = 'square'; g.lineWidth = Math.max(2, s * 0.14);
  const line = (x1, y1, x2, y2, c) => { g.strokeStyle = c; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  for (const c of maze.cells) {
    if (c.R) line(X(c.x + 1), Y(c.z), X(c.x + 1), Y(c.z + 1), '#ff8fa6');
    if (c.F) line(X(c.x), Y(c.z + 1), X(c.x + 1), Y(c.z + 1), '#9fb4e0');
    if (c.x === 0 && c.L) line(X(0), Y(c.z), X(0), Y(c.z + 1), '#ff8fa6');
    if (c.z === 0 && c.B) line(X(c.x), Y(0), X(c.x + 1), Y(0), '#9fb4e0');
  }
  // shortest route from the start corner to the monolith
  const key = (x, z) => x * N + z, prev = new Map([[0, -1]]), q2 = [[0, 0]];
  const open = (c, dx, dz) => (dx === 1 ? !c.R : dx === -1 ? !c.L : dz === 1 ? !c.F : !c.B);
  while (q2.length) {
    const [x, z] = q2.shift(); if (x === maze.goal.x && z === maze.goal.z) break;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = z + dz; if (a < 0 || b < 0 || a >= N || b >= N || prev.has(key(a, b)) || !open(maze.cell(x, z), dx, dz)) continue;
      prev.set(key(a, b), key(x, z)); q2.push([a, b]);
    }
  }
  let k = key(maze.goal.x, maze.goal.z), steps = 0;
  g.strokeStyle = 'rgba(255,122,46,.55)'; g.lineWidth = Math.max(2, s * 0.12); g.beginPath();
  g.moveTo(X(maze.goal.x + 0.5), Y(maze.goal.z + 0.5));
  while (k > 0 && prev.has(k)) { k = prev.get(k); const x = Math.floor(k / N), z = k % N; g.lineTo(X(x + 0.5), Y(z + 0.5)); steps++; }
  g.stroke();
  g.fillStyle = '#ff7a2e'; g.fillRect(X(maze.goal.x + 0.3), Y(maze.goal.z + 0.7), s * 0.4, s * 0.4);
  g.fillStyle = '#f4f4f5'; g.beginPath(); g.arc(X(0.5), Y(0.5), s * 0.18, 0, 7); g.fill();

  const dead = maze.cells.filter((c) => [c.L, c.R, c.F, c.B].filter(Boolean).length === 3).length;
  $('sAcross').textContent = `${N * values.cellSize} m`;
  $('sRoute').textContent = `${steps * values.cellSize} m`;
  $('sDead').textContent = String(dead);
  $('sDensity').textContent = values.sentries ? `1 / ${Math.round((N * N) / values.sentries)} cells` : 'none';
}

// ── contract reads ───────────────────────────────────────────────────────────
async function refresh() {
  const c = read(); const ds = $('dayStatus');
  if (!c) { $('cfgSource').textContent = 'Defaults'; return; }
  try {
    say(ds, 'Reading the contract…');
    const day = await c.currentDay();
    const [cfg, next, fee, paused, holder, ref, tre, owed, info] = await Promise.all([
      c.configFor(day), c.nextConfigDay(), c.entryFee(), c.paused(), c.holderToken(), c.referee(), c.treasury(), c.treasuryOwed(), c.dayInfo(day)]);
    setValues(Object.fromEntries(FIELDS.map((f, i) => [f.key, cfg[i]])));
    $('cfgSource').textContent = 'On-chain'; $('cfgSource').classList.add('on');
    $('feeIn').value = formatEther(fee);
    $('holderIn').value = holder === ZeroAddress ? '' : holder;
    $('refereeIn').value = ref; $('treasuryIn').value = tre;
    $('pausedPill').textContent = paused ? 'Paused' : 'Open'; $('pausedPill').classList.toggle('on', !paused);
    $('pauseBtn').textContent = paused ? 'Reopen entries' : 'Pause entries'; $('pauseBtn').dataset.paused = paused ? '1' : '';
    $('dPot').textContent = `${Number(formatEther(info.pot)).toFixed(4)} ETH`;
    $('dEntries').textContent = String(info.entryCount);
    $('dTreasury').textContent = `${Number(formatEther(owed)).toFixed(4)} ETH`;
    $('dNext').textContent = next > 0n ? (next > day ? 'Tomorrow' : 'Active') : 'None';
    const rows = info.top.map((a, i) => (a === ZeroAddress ? '' : `<tr><td>${i + 1}</td><td class="addr">${short(a)}</td><td>${Number(info.topPoints[i]).toLocaleString('en-US')}</td><td>${(Number(info.topTime[i]) / 1000).toFixed(2)} s</td></tr>`)).join('');
    $('topRows').innerHTML = rows || '<tr><td colspan="4" class="note">No finished runs yet.</td></tr>';
    const list = await c.boosters();
    const lines = await Promise.all(list.map(async (b) => {
      const dec = await tokenDecimals(b.token);
      return `${b.token} ${formatUnits(b.minBalance, dec)} ${Number(b.bps) / 100}`;
    }));
    $('boostIn').value = lines.join('\n');
    say(ds, '');
  } catch (e) { say(ds, 'Could not read the contract: ' + (e.shortMessage || e.message), 'bad'); }
}

async function tokenDecimals(token) {
  try { return Number(await new Contract(token, TOKEN_ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true })).decimals()); }
  catch { return 0; } // NFTs have no decimals: the minimum is a count
}
/** "0xToken 100000 10" per line: token, minimum held (in whole tokens), bonus percent. */
async function parseBoosters(text) {
  const out = [];
  for (const raw of text.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
    const [tok, min, pct] = raw.split(/[\s,]+/);
    if (!isAddress(tok)) throw new Error(`Not an address: ${tok}`);
    const bps = Math.round(Number(pct) * 100);
    if (!(bps > 0 && bps <= 5000)) throw new Error(`Bonus must be between 0.01% and 50%: ${pct}`);
    out.push({ token: getAddress(tok), minBalance: parseUnits(String(min || '1'), await tokenDecimals(tok)), bps });
  }
  return out;
}

// ── contract writes ──────────────────────────────────────────────────────────
async function send(statusEl, label, fn) {
  const c = write();
  if (!c) { say(statusEl, isAddress(contractAddr) ? 'Connect the owner wallet first.' : 'Add the contract address first (Economy and roles).', 'bad'); return; }
  try {
    say(statusEl, `${label}: confirm in your wallet…`);
    const tx = await fn(c);
    say(statusEl, `${label}: waiting for the transaction…`);
    await tx.wait();
    say(statusEl, `${label}: done.`, 'ok');
    refresh();
  } catch (e) { say(statusEl, `${label} failed: ${e.shortMessage || e.reason || e.message}`, 'bad'); }
}

$('saveCfg').addEventListener('click', () => send($('cfgStatus'), 'Save settings', (c) => c.setConfig(FIELDS.map((f) => values[f.key]), when() === 'now')));
$('resetCfg').addEventListener('click', () => (read() ? refresh() : setValues(DEFAULTS)));
$('refresh').addEventListener('click', refresh);
$('walletBtn').addEventListener('click', () => (account ? null : signIn()));
$('signBtn').addEventListener('click', signIn);
$('contractSave').addEventListener('click', async () => {
  const v = $('contractIn').value.trim();
  if (!isAddress(v)) { say($('ecoStatus'), 'That is not a valid address.', 'bad'); return; }
  contractAddr = getAddress(v); store.set(CONTRACT_KEY, contractAddr);
  owner = await readOwner();
  if (owner && owner !== account) { say($('ecoStatus'), `The connected wallet is not this contract's owner (${short(owner)}).`, 'bad'); }
  open();
});
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
  const st = b.closest('.card').querySelector('.status');
  const addr = (id) => { const v = $(id).value.trim(); if (v === '') return ZeroAddress; if (!isAddress(v)) throw new Error('Invalid address'); return getAddress(v); };
  try {
    switch (b.dataset.act) {
      case 'fee': return send(st, 'Entry fee', (c) => c.setEntryFee(parseEther(String($('feeIn').value || '0'))));
      case 'holder': return send(st, 'Holder NFT', (c) => c.setHolderToken(addr('holderIn')));
      case 'referee': return send(st, 'Referee', (c) => c.setReferee(addr('refereeIn')));
      case 'treasury': return send(st, 'Treasury', (c) => c.setTreasury(addr('treasuryIn')));
      case 'pause': return send(st, $('pauseBtn').dataset.paused ? 'Reopen entries' : 'Pause entries', (c) => c.setPaused(!$('pauseBtn').dataset.paused));
      case 'settle': return send(st, 'Settle yesterday', async (c) => c.settle((await c.currentDay()) - 1n));
      case 'boosters': return send(st, 'Point boosters', async (c) => c.setBoosters(await parseBoosters($('boostIn').value)));
      case 'withdraw': return send(st, 'Send treasury', (c) => c.withdrawTreasury());
    }
  } catch (e) { say(st, e.message, 'bad'); }
}));

// ── start ────────────────────────────────────────────────────────────────────
for (const [k, ch] of Object.entries(CHAINS)) $('chainSel').add(new Option(ch.name, k, false, k === CHAIN_KEY));
$('chainSel').addEventListener('change', () => setChain($('chainSel').value));
buildFields(); draw();
try {
  const s = JSON.parse(store.get(SESSION_KEY, sessionStorage) || 'null');
  if (s && s.until > Date.now() && window.ethereum) {
    // reuse this tab's sign-in, but make sure the same wallet is still connected and still the owner
    connect().then(async () => { if (account === s.account) { owner = await readOwner(); if (!owner || owner === account) open(); } }).catch(() => {});
  }
} catch {}
