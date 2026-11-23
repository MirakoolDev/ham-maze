// Wallet and contract calls for paid runs. Practice runs never touch this. Two contracts, by the chain's `flow`:
//   daily (HamDailyRun):    enter (pay the fee), play, the referee checks the run, submitRun records it.
//   robinhood (HamRobinhood): play first, the referee checks the run, then one playRun call pays the fee (or uses
//                           a holder's free run), mints the Score NFT and ranks it.
import { BrowserProvider, JsonRpcProvider, Contract, formatEther, isAddress, getAddress, ZeroAddress } from 'ethers';
import { CHAIN, CHAIN_KEY, FLOW } from './config.js';
import { pickProvider } from './wallet.js';

const ABI = [
  'function entryFee() view returns (uint256)',
  'function currentDay() view returns (uint256)',
  'function enter(address referrer) payable returns (uint32)',
  'function submitRun(uint256 day, uint32 attempt, uint32 points, uint32 timeMs, bytes signature)',
  'function dayInfo(uint256) view returns (uint256 pot, uint256 unclaimed, uint256 settledAt, uint256 entryCount, address[3] top, uint32[3] topPoints, uint32[3] topTime)',
  'function bestPoints(uint256,address) view returns (uint32)',
  'function boostOf(address) view returns (uint256)',
  'function prizeOf(uint256,address) view returns (uint256)',
  'function settle(uint256)',
  'function claim(uint256)',
  'error TooEarly()', 'error AlreadySettled()', 'error NotSettled()', 'error ClaimClosed()', 'error NothingToClaim()',
  'event Entered(uint256 indexed day, address indexed player, uint32 attempt, bool free, uint256 paid)',
  'event RunSubmitted(uint256 indexed day, address indexed player, uint32 attempt, uint32 points, uint32 boosted, uint32 timeMs, bool best)',
];
const RH_ABI = [
  'function entryFee() view returns (uint256)',
  'function currentDay() view returns (uint256)',
  'function dayInfo(uint256) view returns (uint256 pot, uint256 unclaimed, uint256 settledAt, uint256 entryCount, uint256[3] topToken, uint32[3] topPoints, uint32[3] topTime)',
  'function scores(uint256) view returns (uint64 day, address player, uint32 attempt, uint32 points, uint32 timeMs, uint32 kills, bool completed, bool holder)',
  'function holderToken() view returns (address)',
  'function freeRunUsed(uint256,uint256) view returns (bool)',
  'function playRun(tuple(uint32 points, uint32 timeMs, uint32 kills, bool completed, uint32 attempt, uint16 boostBps) r, bytes signature, address referrer) payable returns (uint256)',
  'function playFreeRun(tuple(uint32 points, uint32 timeMs, uint32 kills, bool completed, uint32 attempt, uint16 boostBps) r, bytes signature, address referrer, uint256 passId) returns (uint256)',
  'error WrongFee()', 'error BadSignature()', 'error DayClosed()', 'error BadTime()', 'error Paused()', 'error BadAttempt()', 'error NotHolder()',
  'event RunPlayed(uint256 indexed day, address indexed player, uint32 attempt, uint256 tokenId, uint32 points, uint32 boosted, uint32 timeMs, bool paid)',
];
// The repeat-run rule (HamRobinhood): each run after a wallet's first that day keeps fewer points.
const REPEAT_ABI = [
  'function currentDay() view returns (uint256)',
  'function attempts(uint256,address) view returns (uint32)',
  'function attemptShare(uint32) view returns (uint256)',
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
  /** True on HamRobinhood chains: play first, then pay and record in one call. */
  payAfter: () => FLOW === 'robinhood',
  hasWallet: () => typeof window !== 'undefined' && !!window.ethereum,
  powerupEnabled: () => !!CHAIN.powerup,
  short,
  explorerTx: (h) => `${CHAIN.explorer}/tx/${h}`,

  reader() { return new Contract(CHAIN.contract, this.payAfter() ? RH_ABI : ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true })); },

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
    // HamRobinhood ranks Score tokens, not wallets: look up who played each of the top three
    const who = this.payAfter()
      ? await Promise.all(info.topToken.map(async (t) => (t === 0n ? ZeroAddress : (await k.scores(t)).player)))
      : info.top;
    return {
      day: Number(day), fee: formatEther(fee), pot: formatEther(info.pot), entries: Number(info.entryCount),
      top: who.map((a, i) => ({ who: a, points: Number(info.topPoints[i]), timeMs: Number(info.topTime[i]) })).filter((t) => t.who !== ZeroAddress),
    };
  },

  // The `count` days before `before` (a day number), newest first. Same fields as today(), plus
  // whether the day has been settled (paid out).
  async pastDays(before, count) {
    const k = this.reader();
    const days = Array.from({ length: count }, (_, i) => before - 1 - i).filter((d) => d >= 0);
    const infos = await Promise.all(days.map((d) => k.dayInfo(d)));
    const out = infos.map((info, i) => ({
      day: days[i], pot: formatEther(info.pot), entries: Number(info.entryCount),
      settled: Number(info.settledAt) > 0, settledAt: Number(info.settledAt),
      top: info.top.map((a, j) => ({ who: a, points: Number(info.topPoints[j]), timeMs: Number(info.topTime[j]) })).filter((t) => t.who !== ZeroAddress),
    }));
    // what each settled winner still has to claim (0 once claimed)
    await Promise.all(out.filter((d) => d.settled).flatMap((d) => d.top.map(async (p) => { p.prize = formatEther(await k.prizeOf(d.day, p.who)); })));
    return out;
  },

  /** Pay out a finished day. Anyone can call it once the day is 15 minutes over; it only costs gas. */
  async settleDay(day) {
    await this.connect();
    await this._checkBalance();
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    const tx = await k.settle(day);
    await tx.wait();
    return tx.hash;
  },

  /** Claim the connected wallet's prize for a settled day. */
  async claimDay(day) {
    await this.connect();
    await this._checkBalance();
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    const tx = await k.claim(day);
    await tx.wait();
    return tx.hash;
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

  /**
   * The connected wallet's next run today and the share of its points that run keeps, e.g.
   * { run: 3, pct: 84 }. Null where the contract has no repeat-run rule (the Aurora test contract)
   * or the chain can't be read, so callers simply say nothing.
   */
  async nextRun(account = this.account) {
    if (!account || !this.enabled()) return null;
    const k = new Contract(CHAIN.contract, REPEAT_ABI, new JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true }));
    try {
      const attempt = await k.attempts(await k.currentDay(), account);
      const bps = await k.attemptShare(attempt);
      return { run: Number(attempt) + 1, pct: Number(bps) / 100 };
    } catch { return null; }
  },

  /** Who referred this player (?ref=0x...), or the zero address. */
  _referrer() {
    let ref = null;
    try { ref = new URLSearchParams(location.search).get('ref'); } catch {}
    return ref && isAddress(ref) ? getAddress(ref) : ZeroAddress;
  },

  /**
   * HamRobinhood: a ticket for a run that is paid for at the end, { day, attempt, payAfter: true }. Nothing is
   * sent; it only connects the wallet so the referee can sign for it once the run is over.
   */
  async ticketForLater() {
    await this.connect();
    const k = this.reader();
    const day = Number(await k.currentDay());
    const next = await this.nextRun();
    return { day, attempt: next ? next.run - 1 : 0, payAfter: true };
  },

  /**
   * HamRobinhood: a holder NFT this wallet owns whose free run today is unused, or null. Free runs are per
   * NFT, so the contract needs its id; this finds one through ERC721Enumerable, and finds none (so the run
   * is paid) if the holder NFT doesn't support it.
   */
  async freePass() {
    const k = this.reader();
    const token = await k.holderToken();
    if (!this.account || token === ZeroAddress) return null;
    const nft = new Contract(token, ['function balanceOf(address) view returns (uint256)', 'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)'], k.runner);
    try {
      const [day, n] = await Promise.all([k.currentDay(), nft.balanceOf(this.account)]);
      for (let i = 0n; i < n && i < 20n; i++) {
        const id = await nft.tokenOfOwnerByIndex(this.account, i);
        if (!(await k.freeRunUsed(day, id))) return id;
      }
    } catch {}
    return null;
  },

  /** HamRobinhood: what recording a run costs this wallet right now, in wei (0 for a holder's free run). */
  async feeNow() {
    const [fee, pass] = await Promise.all([this.reader().entryFee(), this.freePass()]);
    return pass !== null ? 0n : fee;
  },

  /** HamRobinhood: pay (or use the free run), record the signed run and mint its Score, all in one call. */
  async playRun(signed) {
    await this.connect();
    const k = new Contract(CHAIN.contract, RH_ABI, this.signer);
    const r = [signed.points, signed.timeMs, signed.kills, signed.completed, signed.attempt, signed.boostBps ?? 0];
    const pass = await this.freePass();
    let tx;
    if (pass !== null) tx = await k.playFreeRun(r, signed.signature, this._referrer(), pass);
    else {
      const value = await this.reader().entryFee();
      await this._checkBalance(value);
      tx = await k.playRun(r, signed.signature, this._referrer(), { value });
    }
    const rc = await tx.wait();
    for (const log of rc.logs) {
      try {
        const ev = k.interface.parseLog(log);
        if (ev?.name === 'RunPlayed') return { boosted: Number(ev.args.boosted), tokenId: Number(ev.args.tokenId), paid: ev.args.paid, tx: tx.hash };
      } catch {}
    }
    throw new Error('The run went through but its receipt had no RunPlayed event');
  },

  /** Pay for one run. Returns the ticket { day, attempt } the run will be recorded against. */
  async enter() {
    await this.connect(); // cheap if already connected and on the right chain; fixes it otherwise
    const k = new Contract(CHAIN.contract, ABI, this.signer);
    const referrer = this._referrer();
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
