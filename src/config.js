// Game settings. The live values come from the HamDailyRun contract on Robinhood Chain (set from the admin page);
// until it is deployed, or if the chain does not answer in time, the defaults below are used.
// ?preview&mazeSize=16&cellSize=9... overrides them locally (the admin page's preview link), and such runs never count.

export const CHAIN = {
  id: 4663,
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://explorer.chain.robinhood.com',
  contract: '', // HamDailyRun address, filled in after deployment
};

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

const clampAll = (c) => {
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
  clampAll(CFG);
  return CFG;
}
