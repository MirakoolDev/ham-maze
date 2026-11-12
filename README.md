# HAM — Home's a Maze

A first-person maze shooter for the browser. One maze a day, the same for everyone: find the monolith, get past the sentries, beat the clock.

- `npm install`
- `npm run dev` — dev server on http://localhost:5173 with rebuild on save
- `npm run build` — single-file build in `dist/` (`index.html` for hosting, `artifact.html` for Claude artifacts)

Deploys on Vercel as a static site (`vercel.json`: build `npm run build`, output `dist`).

Design notes for the onchain daily run and Maze Royale are in `design/royale.src.html`.
