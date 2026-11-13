// POST /api/referee — checks a finished run and signs its points for HamDailyRun.submitRun.
// Body: { chain, player, day, attempt, run: { timeMs, walked, kills, rivals } }
// The referee rebuilds the day's maze from the seed and the on-chain settings, computes the shortest route itself,
// rejects runs that are physically impossible, scores the run with the shared formula and signs that score.
// It never trusts points sent by the client. Env: REFEREE_KEY (hex private key), optional HAM_CONTRACT_<CHAIN>.
import { JsonRpcProvider, Contract, Wallet, getBytes, isAddress, getAddress } from 'ethers';
import { CHAINS, FIELDS } from '../src/config.js';
import { dailySeed } from '../src/maze.js';
import { dayMaze, shortestMetres, scoreRun, implausible } from '../src/score.js';

const ABI = [
  'function configFor(uint256) view returns (tuple(uint8,uint8,uint8,uint8,uint8,uint8,uint8,uint8))',
  'function attempts(uint256,address) view returns (uint32)',
  'function attemptUsed(uint256,address,uint32) view returns (bool)',
  'function runDigest(uint256,address,uint32,uint32,uint32) view returns (bytes32)',
  'function referee() view returns (address)',
  'function currentDay() view returns (uint256)',
];

export function contractFor(chainKey) {
  const env = process.env[`HAM_CONTRACT_${chainKey.toUpperCase().replace(/-/g, '_')}`];
  return env || CHAINS[chainKey]?.contract || '';
}

export async function referee(body, key = process.env.REFEREE_KEY) {
  const fail = (status, error) => ({ status, body: { error } });
  if (!key) return fail(500, 'Referee key not configured');
  const { chain, player, day, attempt, run } = body || {};
  const c = CHAINS[chain];
  if (!c) return fail(400, 'Unknown chain');
  const address = contractFor(chain);
  if (!isAddress(address)) return fail(400, 'No contract on this chain yet');
  if (!isAddress(player)) return fail(400, 'Bad player');
  if (!Number.isInteger(day) || !Number.isInteger(attempt) || attempt < 0) return fail(400, 'Bad day or attempt');
  if (!run || typeof run !== 'object') return fail(400, 'Missing run');
  const r = { timeMs: Math.round(Number(run.timeMs)), walked: Number(run.walked), kills: Math.round(Number(run.kills) || 0), rivals: Math.round(Number(run.rivals) || 0) };

  const provider = new JsonRpcProvider(c.rpc, c.id, { staticNetwork: true });
  const k = new Contract(address, ABI, provider);
  const wallet = new Wallet(key);
  const p = getAddress(player);
  const [ref, today, bought, used, cfgRaw] = await Promise.all([k.referee(), k.currentDay(), k.attempts(day, p), k.attemptUsed(day, p, attempt), k.configFor(day)]);
  if (getAddress(ref) !== wallet.address) return fail(500, 'This server is not the contract\'s referee');
  if (BigInt(day) !== today && BigInt(day) + 1n !== today) return fail(400, 'That day is closed');
  if (BigInt(attempt) >= bought) return fail(400, 'No paid run with that number');
  if (used) return fail(400, 'That run was already recorded');

  const cfg = Object.fromEntries(FIELDS.map((f, i) => [f.key, Number(cfgRaw[i])]));
  const maze = dayMaze(dailySeed(new Date(day * 86400e3)), cfg);
  const shortest = shortestMetres(maze, cfg.cellSize);
  const why = implausible(r, shortest, cfg);
  if (why) return fail(422, `Run rejected: ${why}`);

  const score = scoreRun(r, shortest);
  const points = Math.min(score.total, 0xffffffff);
  const digest = await k.runDigest(day, p, attempt, points, r.timeMs);
  const signature = await wallet.signMessage(getBytes(digest));
  return { status: 200, body: { chain, day, attempt, player: p, points, timeMs: r.timeMs, breakdown: score, shortest: Math.round(shortest), signature } };
}

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const out = await referee(body);
    res.status(out.status).json(out.body);
  } catch (e) {
    res.status(500).json({ error: e.shortMessage || e.message || 'Referee error' });
  }
}
