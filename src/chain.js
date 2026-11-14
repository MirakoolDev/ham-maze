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
const NFT_ABI = [
  'function mint() returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'error AlreadyMinted()',
  'error SoldOut()',
];
// The referee runs as a Vercel function; on the local dev server (port 5173) it runs beside it on 5174.
const API = typeof location !== 'undefined' && location.port === '5173' ? `${location.protocol}//${location.hostname}:5174` : '';
const HEX = '0x' + CHAIN.id.toString(16);
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);

export const chain = {
  key: CHAIN_KEY, info: CHAIN, account: null, signer: null,
  enabled: () => !!CHAIN.contract,
  hasWallet: () => typeof window !== 'undefined' && !!window.ethereum,
  powerupEnabled: () => !!CHAIN.powerup,
  short,
  explorerTx: (h) => `${CHAIN.explorer}/tx/${h}`,

  reader() { return new Contract(CHAIN.contract, ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true })); },

  // Connecting again (another run, another day) reuses this instead of re-prompting the wallet
  // every time: same provider, same account, as long as nothing actually needs fixing.
  _eth: null,

  /** True once connect() has run and the wallet is still on the right chain and account. */
  async _stillGood() {
    if (!this._eth || !this.signer || !this.account) return false;
    try {
      const [chainIdHex, accounts] = await Promise.all([
        this._eth.request({ method: 'eth_chainId' }),
        this._eth.request({ method: 'eth_accounts' }),
      ]);
      return chainIdHex?.toLowerCase() === HEX.toLowerCase() && accounts[0]?.toLowerCase() === this.account.toLowerCase();
    } catch { return false; }
  },

  async connect() {
    if (await this._stillGood()) return this.account; // no wallet popup: already connected, right chain
    const eth = this._eth || await pickProvider();
    let provider = new BrowserProvider(eth, 'any');
    // Silent first (no popup) - eth_requestAccounts re-prompts in some wallets even when already
    // permitted, which is exactly the "asks me to connect again for every run" friction.
    let accounts = await eth.request({ method: 'eth_accounts' }).catch(() => []);
    let acc = accounts[0];
    if (!acc) [acc] = await provider.send('eth_requestAccounts', []);
    const chainIdHex = await eth.request({ method: 'eth_chainId' }).catch(() => null);
    if (chainIdHex?.toLowerCase() !== HEX.toLowerCase()) {
      try { await provider.send('wallet_switchEthereumChain', [{ chainId: HEX }]); }
      catch (e) {
        if (e?.error?.code === 4902 || e?.code === 4902 || /unrecognized|not added|unknown chain/i.test(e?.message || '')) {
          await provider.send('wallet_addEthereumChain', [{ chainId: HEX, chainName: CHAIN.name, rpcUrls: [CHAIN.rpc], nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [CHAIN.explorer] }]);
        } else throw e;
      }
    }
    provider = new BrowserProvider(eth, 'any');
    this.signer = await provider.getSigner();
    this.account = getAddress(acc);
    this._eth = eth;
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

  /**
   * Checks the connected wallet actually has enough for `need` plus a small gas cushion before
   * sending anything, and throws our own plain message instead of letting it hit the chain and
   * come back as a wallet's opaque "missing revert data" / "insufficient funds" with no reason.
   */
  async _checkBalance(need = 0n) {
    const have = await this.signer.provider.getBalance(this.account);
    const GAS_CUSHION = 50000000000000n; // 0.00005 ETH: generous for Aurora's low gas, just a floor check
    if (have < need + GAS_CUSHION) {
      const short = need > 0n ? `${formatEther(need)} ETH plus gas` : 'enough ETH for gas';
      throw new Error(`Your wallet only has ${formatEther(have)} ETH on ${CHAIN.name}, which isn't enough (needs ${short}).${CHAIN.testnet ? ' Get more from the Aurora faucet: aurora.dev/faucet' : ''}`);
    }
  },

  /** Pay for one run. Returns the ticket { day, attempt } the run will be recorded against. */
  async enter() {
    await this.connect(); // cheap if already connected and on the right chain; fixes it otherwise
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    let ref = null;
    try { ref = new URLSearchParams(location.search).get('ref'); } catch {}
    const referrer = ref && isAddress(ref) ? getAddress(ref) : ZeroAddress;
    const fee = await k.entryFee();
    await this._checkBalance(fee);
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
    await this.connect(); // the wallet may have drifted chain/account since enter()
    await this._checkBalance();
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    const tx = await k.submitRun(signed.day, signed.attempt, signed.points, signed.timeMs, signed.signature);
    const rc = await tx.wait();
    for (const log of rc.logs) {
      try { const ev = k.interface.parseLog(log); if (ev?.name === 'RunSubmitted') return { boosted: Number(ev.args.boosted), best: ev.args.best, tx: tx.hash }; } catch {}
    }
    return { boosted: signed.points, best: false, tx: tx.hash };
  },

  /** Whether `account` already holds the power-up NFT, read-only, no wallet needed. */
  async powerupOwned(account) {
    const k = new Contract(CHAIN.powerup, NFT_ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true }));
    return (await k.balanceOf(account)) > 0n;
  },

  /** How many of the power-up NFT are left, read-only, no wallet needed. */
  async powerupSupply() {
    const k = new Contract(CHAIN.powerup, NFT_ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true }));
    const [total, max] = await Promise.all([k.totalSupply(), k.MAX_SUPPLY()]);
    return { total: Number(total), max: Number(max) };
  },

  /** Mint the power-up NFT. Free; one per wallet. Returns the tx hash. */
  async mintPowerup() {
    await this.connect();
    await this._checkBalance();
    const k = new Contract(CHAIN.powerup, NFT_ABI, this.signer);
    const tx = await k.mint();
    const rc = await tx.wait();
    return rc.hash;
  },
};
