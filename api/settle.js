// GET /api/settle: pays out finished days so nobody has to press "Pay out this day".
// Vercel Cron calls it once a day (vercel.json). settle() is open to anyone and only costs gas, so any funded
// wallet works: SETTLER_KEY if set, otherwise the referee's key (that address then needs a little ETH for gas).
// It looks back LOOKBACK days on every chain with a contract and settles each finished, unsettled day that has
// a pot, including pots that rolled over into a day nobody played, so money never sits stuck.
// ?dry=1 lists what it would do without sending anything. With CRON_SECRET set, only Vercel Cron can run it for real.
import { JsonRpcProvider, Contract, Wallet, formatEther } from 'ethers';
import { CHAINS } from '../src/config.js';
import { contractFor } from './referee.js';

const ABI = [
  'function currentDay() view returns (uint256)',
  'function SETTLE_DELAY() view returns (uint256)',
  'function dayInfo(uint256) view returns (uint256 pot, uint256 unclaimed, uint256 settledAt, uint256 entryCount, address[3] top, uint32[3] topPoints, uint32[3] topTime)',
  'function settle(uint256)',
];
const LOOKBACK = 7;

export async function settleDue({ dry = false, key = process.env.SETTLER_KEY || process.env.REFEREE_KEY } = {}) {
  if (!key && !dry) return { status: 500, body: { error: 'No SETTLER_KEY or REFEREE_KEY configured' } };
  const report = [];
  for (const [chainKey, c] of Object.entries(CHAINS)) {
    const address = contractFor(chainKey);
    if (!address) continue;
    const out = { chain: chainKey, settled: [], skipped: [], errors: [] };
    report.push(out);
    try {
      const provider = new JsonRpcProvider(c.rpc, c.id, { staticNetwork: true });
      const wallet = key ? new Wallet(key, provider) : null;
      const k = new Contract(address, ABI, wallet || provider);
      const [today, delay, block] = await Promise.all([k.currentDay(), k.SETTLE_DELAY(), provider.getBlock('latest')]);
      if (wallet) out.settler = { address: wallet.address, balance: formatEther(await provider.getBalance(wallet.address)) };
      for (let i = 1n; i <= BigInt(LOOKBACK) && today >= i; i++) {
        const day = today - i;
        const info = await k.dayInfo(day);
        if (info.settledAt > 0n || info.pot === 0n) continue;
        if (BigInt(block.timestamp) < (day + 1n) * 86400n + delay) { out.skipped.push({ day: Number(day), why: 'too early' }); continue; }
        const row = { day: Number(day), pot: formatEther(info.pot), runs: Number(info.entryCount) };
        if (dry) { out.settled.push({ ...row, dry: true }); continue; }
        try {
          const tx = await k.settle(day);
          await tx.wait();
          out.settled.push({ ...row, tx: tx.hash });
        } catch (e) {
          out.errors.push({ day: Number(day), error: e.shortMessage || e.message });
        }
      }
    } catch (e) {
      out.errors.push({ error: e.shortMessage || e.message });
    }
  }
  return { status: 200, body: { dry, report } };
}

export default async function handler(req, res) {
  const dry = req.query?.dry === '1' || /[?&]dry=1/.test(req.url || '');
  const secret = process.env.CRON_SECRET;
  if (!dry && secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const out = await settleDue({ dry });
    res.status(out.status).json(out.body);
  } catch (e) {
    res.status(500).json({ error: e.shortMessage || e.message || 'Settle error' });
  }
}
