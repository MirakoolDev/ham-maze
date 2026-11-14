// Wallet and contract calls for paid runs: enter (pay the fee), ask the referee to check the run, submit the signed
// score. Practice runs never touch this.
import { BrowserProvider, JsonRpcProvider, Contract, formatEther, isAddress, getAddress, ZeroAddress } from 'ethers';
import { CHAIN, CHAIN_KEY } from './config.js';
import { pickProvider } from './wallet.js';

const ABI = [
  'function entryFee() view returns (uint256)',
  'function currentDay() view returns (uint256)',
  'function enter(address referrer) payable returns (uint32)',
  'function submitRun(uint256 day, uint32 attempt, uint32 points, uint32 timeMs, bytes signature)',
  'function dayInfo(uint256) view returns (uint256 pot, uint256 unclaimed, uint256 settledAt, uint256 entryCount, address[3] top, uint32[3] topPoints, uint32[3] topTime)',
  'function bestPoints(uint256,address) view returns (uint32)',
  'function boostOf(address) view returns (uint256)',
  'event Entered(uint256 indexed day, address indexed player, uint32 attempt, bool free, uint256 paid)',
  'event RunSubmitted(uint256 indexed day, address indexed player, uint32 attempt, uint32 points, uint32 boosted, uint32 timeMs, bool best)',
];
// The referee runs as a Vercel function; on the local dev server (port 5173) it runs beside it on 5174.
const API = typeof location !== 'undefined' && location.port === '5173' ? `${location.protocol}//${location.hostname}:5174` : '';
const HEX = '0x' + CHAIN.id.toString(16);
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);

export const chain = {
  key: CHAIN_KEY, info: CHAIN, account: null, signer: null,
  enabled: () => !!CHAIN.contract,
  hasWallet: () => typeof window !== 'undefined' && !!window.ethereum,
  short,
  explorerTx: (h) => `${CHAIN.explorer}/tx/${h}`,

  reader() { return new Contract(CHAIN.contract, ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true })); },

  async connect() {
    const eth = await pickProvider();
    let provider = new BrowserProvider(eth, 'any');
    const [acc] = await provider.send('eth_requestAccounts', []);
    try { await provider.send('wallet_switchEthereumChain', [{ chainId: HEX }]); }
    catch (e) {
      if (e?.error?.code === 4902 || e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || '')) {
        await provider.send('wallet_addEthereumChain', [{ chainId: HEX, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [CHAIN.explorer] }]);
      } else throw e;
    }
    provider = new BrowserProvider(eth, 'any');
    this.signer = await provider.getSigner();
    this.account = getAddress(acc);
    return this.account;
  },

  /** Today's pot, run count and podium (read-only, no wallet needed). */
  async today() {
    const k = this.reader();
    const day = await k.currentDay();
    const [info, fee] = await Promise.all([k.dayInfo(day), k.entryFee()]);
    return {
      day: Number(day), fee: formatEther(fee), pot: formatEther(info.pot), entries: Number(info.entryCount),
      top: info.top.map((a, i) => ({ who: a, points: Number(info.topPoints[i]), timeMs: Number(info.topTime[i]) })).filter((t) => t.who !== ZeroAddress),
    };
  },

  /** Pay for one run. Returns the ticket { day, attempt } the run will be recorded against. */
  async enter() {
    if (!this.signer) await this.connect();
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    let ref = null;
    try { ref = new URLSearchParams(location.search).get('ref'); } catch {}
    const referrer = ref && isAddress(ref) ? getAddress(ref) : ZeroAddress;
    const fee = await k.entryFee();
    const tx = await k.enter(referrer, { value: fee });
    const rc = await tx.wait();
    for (const log of rc.logs) {
      try { const ev = k.interface.parseLog(log); if (ev?.name === 'Entered') return { day: Number(ev.args.day), attempt: Number(ev.args.attempt), tx: tx.hash }; } catch {}
    }
    throw new Error('Entry went through but its receipt had no Entered event');
  },

  /** Ask the referee to check the run and sign its points. */
  async check(ticket, run) {
    const res = await fetch(`${API}/api/referee`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chain: CHAIN_KEY, player: this.account, day: ticket.day, attempt: ticket.attempt, run }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Referee answered ${res.status}`);
    return out;
  },

  /** Record the signed run on-chain. Returns { boosted, best, tx }. */
  async submit(signed) {
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    const tx = await k.submitRun(signed.day, signed.attempt, signed.points, signed.timeMs, signed.signature);
    const rc = await tx.wait();
    for (const log of rc.logs) {
      try { const ev = k.interface.parseLog(log); if (ev?.name === 'RunSubmitted') return { boosted: Number(ev.args.boosted), best: ev.args.best, tx: tx.hash }; } catch {}
    }
    return { boosted: signed.points, best: false, tx: tx.hash };
  },
};
