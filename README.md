# HAM — Home's a Maze

A first-person maze shooter for the browser. One maze a day, the same for everyone: find the orange monolith, get past the sentries, and score as many points as you can. Pay a small fee in ETH to play for the day's pot; the top three runs split it.

Music by **Rere Aiyemomi**.

## Built on NEAR (Aurora)

HAM's on-chain game runs on **Aurora**, the Ethereum-compatible chain that runs as a smart contract on NEAR. Every paid entry, every recorded score and the daily payout are Aurora transactions settled by NEAR validators.

**Live on Aurora Testnet:** [`0xa05A8D95a26c7CD12d4Ae26CBbE8906c92FA1869`](https://explorer.testnet.aurora.dev/address/0xa05A8D95a26c7CD12d4Ae26CBbE8906c92FA1869), source verified on the explorer.

| What | Where |
| --- | --- |
| Daily pot, entries, scores, payouts | `contracts/src/HamDailyRun.sol`, deployed to Aurora Testnet (chain 1313161555) |
| Network settings (RPC, explorer, chain switch) | `src/config.js` (`CHAINS`) |
| Wallet: pay to enter, submit a signed score | `src/chain.js` |
| Referee that checks a run and signs its points | `api/referee.js` (Vercel function) |
| Shared points formula and cheat checks | `src/score.js` |
| Owner settings page | `/admin` (`src/admin.js`) |
| Deploy sandbox — connect your own wallet and sign | `/deploy` (`src/deploy.js`) |

**Other chains (disclosure).** The same contract is set up to also run on Robinhood Chain (chain 4663), with a switch in the game and admin page. That deployment is part of the wider project and is not part of this NEAR hackathon entry. Only the Aurora/NEAR integration above is submitted for judging.

### How a paid run works

1. **Enter.** Pick a chain on the title screen and press *Play for the pot*. Your wallet pays the entry fee to `HamDailyRun.enter()`. 100% of it goes into today's pot.
2. **Play.** Reach the monolith. Retries during the run are free.
3. **Referee.** The game sends the run (time, distance walked, sentries destroyed) to `/api/referee`. The referee rebuilds the day's maze from the seed and the on-chain settings, works out the shortest route itself, rejects impossible runs and signs the points. It never trusts points sent by the browser.
4. **Record.** Your wallet submits the signed points to `submitRun()`. The contract checks the signature, adds any holder boosts (for example $PFWA holders) and keeps your best run of the day.
5. **Payout.** After the UTC day ends, `settle()` pays the top three 40/20/10. 20% goes to the treasury for the project's backers, and 10% rolls into tomorrow's pot.

### Points

Speed (up to 12,000) + route (up to 2,000 for walking the shortest way) + 400 per sentry + 600 per rival beaten, then multiplied by holder boosts (up to +50%). Ties go to the faster time.

## Try it

- `npm install`
- `npm run dev` — game on http://localhost:5173, admin on http://localhost:5173/admin.html
- `node api/dev.mjs` — local referee on http://localhost:5174 (reads `REFEREE_KEY` from `.env.local`, which is never committed)
- `npm run build` — single-file build in `dist/` (`index.html`, `admin.html`, and `artifact.html` for Claude artifacts)

Practice runs need no wallet. To play for the pot you need a wallet on Aurora Testnet with testnet ETH from the [Aurora faucet](https://aurora.dev/faucet).

### Deploy the contract

Easiest: open `/deploy` in a browser with a wallet extension. It connects your wallet, switches to Aurora Testnet, and lets you sign and send the deploy transaction yourself — no private key ever touches the page.

Or from the CLI:

```
cd contracts
forge test
HAM_OWNER=0x… HAM_REFEREE=0x… HAM_TREASURY=0x… HAM_ENTRY_FEE=300000000000000 \
  forge script script/Deploy.s.sol --rpc-url https://testnet.aurora.dev --broadcast --account <keystore>
```

Either way, put the deployed address in `CHAINS['aurora-testnet'].contract` in `src/config.js` (or the `HAM_CONTRACT_AURORA_TESTNET` env var for the referee).

### Deploy the site (Vercel)

1. Import this repo in Vercel. It auto-detects `vercel.json` (`buildCommand: npm run build`, `outputDirectory: dist`) — no framework preset needed.
2. Add one environment variable: `REFEREE_KEY`, the private key in `.env.local` (never commit that file). This is what signs run scores server-side at `/api/referee`.
3. Deploy. The game, `/admin` and `/deploy` are all static pages built into `dist/`; the referee runs as a Vercel serverless function at `/api/referee`.

## Admin page

`/admin`. Connect the owner wallet and sign a free message to open it. It edits the settings stored in the contract (maze size, cell size, sentries, sentry health and damage, player health, magazine size and loops), the entry fee, holder token, point boosters, referee, treasury and pause, on whichever chain you pick. Settings apply from the next UTC day, or right away if nobody has entered today. *Preview in game* lets you walk a setting before saving it.

## Contracts

`contracts/` is a Foundry project with 26 tests, including a solvency fuzz test. Not audited.

## Built with

[three.js](https://threejs.org) (rendering), [ethers](https://docs.ethers.org) (wallet and contract calls), [esbuild](https://esbuild.github.io) (bundling), [Foundry](https://getfoundry.sh) with forge-std (contracts and tests), Aurora on NEAR (chain).

## Credits

- Game and art direction: MirakoolDev
- Music: **Rere Aiyemomi**
- The game's code was written with help from Claude (Anthropic).

## License

MIT — see `LICENSE`. The music is © Rere Aiyemomi and is not covered by the MIT license.
