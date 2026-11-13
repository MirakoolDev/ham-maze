# HAM — Home's a Maze

A first-person maze shooter for the browser. One maze a day, the same for everyone: find the monolith, get past the sentries, beat the clock.

- `npm install`
- `npm run dev` — dev server on http://localhost:5173 with rebuild on save
- `npm run build` — single-file build in `dist/` (`index.html` for hosting, `artifact.html` for Claude artifacts)

Deploys on Vercel as a static site (`vercel.json`: build `npm run build`, output `dist`).

Design notes for the onchain daily run and Maze Royale are in `design/royale.src.html`.

## Admin page

`/admin` (built to `dist/admin.html`). Connect the owner wallet and sign a free message to open it. It edits the settings stored in the `HamDailyRun` contract: maze size, cell size, sentries, sentry health and damage, player health, magazine size and loops, plus the entry fee, holder NFT, referee, treasury and pause. Changes apply from the next UTC day, or right away if nobody has entered today. The preview button opens the game with `?preview&...` so you can walk a setting before saving it.

The game reads the live settings from the contract on load (`src/config.js`, set `CHAIN.contract` after deploying) and falls back to the defaults.

## Contracts

`contracts/` is a Foundry project. `HamDailyRun.sol` holds the daily pot: paid runs, a free run for holders, referee-signed times, top-3 payout (40/20/10), 20% treasury for the FundingWorks backers (which first pays the holder bonus and referral rewards), 10% rollover, 7-day claims and sweeps.

```
cd contracts
forge test
HAM_OWNER=0x… HAM_REFEREE=0x… HAM_TREASURY=0x… forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --account <keystore>
```

Not audited. The referee (the replay server that signs times) is not built yet.
