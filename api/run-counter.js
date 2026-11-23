// How many runs the referee has signed for a wallet today. HamRobinhood cuts each run's points by
// its signed attempt number (8% per run after the first, down to 60%), so this count has to include
// runs that were signed but never submitted: otherwise a player could play ten runs, submit only
// the best, and keep it at 100%. (IMD audit, finding 3.)
//
// Storage: a Redis that speaks the Upstash REST protocol, which is what Vercel's Redis/KV
// integration provides (KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL +
// UPSTASH_REDIS_REST_TOKEN). Without one, local dev keeps the count in memory; on Vercel the
// referee refuses to sign, since an in-memory count resets between function instances.

const TTL = 3 * 86400; // a day's count only matters until that day settles
const memory = new Map();

// Atomically: count this run, never below the on-chain attempt (runs already submitted), and
// return this run's attempt number (0 = the first today).
const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
local floor = tonumber(ARGV[1])
if n - 1 < floor then n = floor + 1; redis.call('SET', KEYS[1], n) end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return n - 1`;

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export class CounterUnavailable extends Error {}

/** The attempt number to sign for this run. `onChain` is attempts(day, player) from the contract. */
export async function nextAttempt({ contract, day, player, onChain }) {
  const key = `ham:runs:${contract.toLowerCase()}:${day}:${player.toLowerCase()}`;
  const s = store();
  if (s) {
    const res = await fetch(s.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(['EVAL', SCRIPT, '1', key, String(onChain), String(TTL)]),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error || !Number.isInteger(out.result)) throw new CounterUnavailable(`Run counter error: ${out.error || res.status}`);
    return out.result;
  }
  if (process.env.VERCEL) throw new CounterUnavailable('The run counter is not configured on this server');
  const n = Math.max((memory.get(key) ?? 0) + 1, onChain + 1);
  memory.set(key, n);
  return n - 1;
}
