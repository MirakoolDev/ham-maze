// Game settings and chains. The live settings come from the HamDailyRun contract on the selected chain (set from the
// admin page); until it is deployed, or if the chain does not answer in time, the defaults below are used.
// ?preview&mazeSize=16&cellSize=9... overrides them locally (the admin page's preview link), and such runs never count.
// ?chain=aurora-testnet picks the chain (remembered for next time).

// The same contract is deployed on each chain; each has its own pot and leaderboard. Fill in `contract` after
// deploying. `powerup` is the HamPowerUp NFT, if one is deployed and registered as a booster on that chain.
export const CHAINS = {
  'aurora-testnet': { id: 1313161555, name: 'Aurora Testnet', rpc: 'https://testnet.aurora.dev', explorer: 'https://explorer.testnet.aurora.dev', contract: '0xa05A8D95a26c7CD12d4Ae26CBbE8906c92FA1869', powerup: '0xe28b8E86028dED8D25b6B3800027032da37922a1', testnet: true },
  aurora: { id: 1313161554, name: 'Aurora', rpc: 'https://mainnet.aurora.dev', explorer: 'https://explorer.aurora.dev', contract: '', powerup: '' },
  robinhood: { id: 4663, name: 'Robinhood Chain', rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://explorer.chain.robinhood.com', contract: '', powerup: '' },
};
export const DEFAULT_CHAIN = 'aurora-testnet';

function pickChain() {
  let k = null;
  try { k = new URLSearchParams(location.search).get('chain'); } catch {}
  try { if (k && CHAINS[k]) localStorage.setItem('ham.chain', k); else k = localStorage.getItem('ham.chain'); } catch {}
  return CHAINS[k] ? k : DEFAULT_CHAIN;
}
export const CHAIN_KEY = typeof location === 'undefined' ? DEFAULT_CHAIN : pickChain();
export const CHAIN = CHAINS[CHAIN_KEY];
export function setChain(key) {
  try { localStorage.setItem('ham.chain', key); } catch {}
  const u = new URL(location.href); u.searchParams.set('chain', key); location.href = u.toString();
}

// Same order and bounds as HamDailyRun.GameConfig.
export const FIELDS = [
  { key: 'mazeSize', label: 'Maze size', unit: 'cells per side', min: 8, max: 32, def: 12 },
  { key: 'cellSize', label: 'Cell size', unit: 'metres', min: 4, max: 14, def: 7 },
  { key: 'sentries', label: 'Sentries', unit: '', min: 0, max: 64, def: 8 },
  { key: 'sentryHealth', label: 'Sentry health', unit: 'hp', min: 10, max: 250, def: 60 },
  { key: 'sentryDamage', label: 'Sentry damage', unit: 'per bolt', min: 1, max: 100, def: 13 },
  { key: 'playerHealth', label: 'Player health', unit: 'hp', min: 50, max: 250, def: 100 },
  { key: 'magSize', label: 'Magazine', unit: 'rounds', min: 5, max: 100, def: 30 },
  { key: 'loops', label: 'Loops', unit: 'extra openings', min: 0, max: 100, def: 0 },
];

export const DEFAULTS = Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));
export const CFG = { ...DEFAULTS, source: 'default', preview: false };

export const clampConfig = (c) => {
  for (const f of FIELDS) c[f.key] = Math.max(f.min, Math.min(f.max, Math.round(Number(c[f.key]) || f.def)));
  return c;
};

/** eth_call to currentConfig() (selector 0xcae58807): eight uint8 words. */
export async function readChainConfig(address = CHAIN.contract, rpc = CHAIN.rpc, timeoutMs = 2500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(rpc, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: address, data: '0xcae58807' }, 'latest'] }),
    });
    const { result } = await res.json();
    if (!result || result.length < 2 + 64 * FIELDS.length) return null;
    return Object.fromEntries(FIELDS.map((f, i) => [f.key, parseInt(result.slice(2 + i * 64, 2 + (i + 1) * 64), 16)]));
  } catch { return null; } finally { clearTimeout(timer); }
}

export async function loadConfig() {
  const q = new URLSearchParams(location.search);
  if (q.has('preview')) {
    for (const f of FIELDS) if (q.has(f.key)) CFG[f.key] = q.get(f.key);
    CFG.source = 'preview'; CFG.preview = true;
  } else if (CHAIN.contract) {
    const c = await readChainConfig();
    if (c) { Object.assign(CFG, c); CFG.source = 'chain'; }
  }
  clampConfig(CFG);
  return CFG;
}
