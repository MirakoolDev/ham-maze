// Dev:   node build.mjs --dev   -> serves www/ on http://localhost:5173 with rebuild on save
// Build: node build.mjs         -> dist/index.html (self-contained), dist/admin.html, dist/deploy.html, dist/leaderboard.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
const tpl = fs.readFileSync('src/index.html', 'utf8');
const loader = { '.jpg': 'dataurl', '.png': 'dataurl', '.otf': 'dataurl', '.mp3': 'dataurl' };
const fill = (html, css, js) => html.replace('<!--CSS-->', () => css).replace('<!--JS-->', () => js);

if (dev) {
  fs.mkdirSync('www', { recursive: true });
  const writeHtml = () => fs.writeFileSync('www/index.html',
    fill(fs.readFileSync('src/index.html', 'utf8'), '<link rel="stylesheet" href="ui.css">', '<script src="main.js"></script>'));
  const writeAdmin = () => fs.writeFileSync('www/admin.html', fill(fs.readFileSync('src/admin.html', 'utf8'), '', '<script src="admin.js"></script>'));
  const writeDeploy = () => fs.writeFileSync('www/deploy.html', fill(fs.readFileSync('src/deploy.html', 'utf8'), '', '<script src="deploy.js"></script>'));
  const writeLeaderboard = () => fs.writeFileSync('www/leaderboard.html', fill(fs.readFileSync('src/leaderboard.html', 'utf8'), '', '<script src="leaderboard.js"></script>'));
  fs.copyFileSync('assets/favicon.png', 'www/favicon.png');
  fs.copyFileSync('assets/favicon-180.png', 'www/favicon-180.png');
  fs.mkdirSync('www/brand', { recursive: true });
  for (const [from, to] of [['logo.png', 'logo.png'], ['bread-island.otf', 'bread-island.otf'], ['cabinet-grotesk.otf', 'cabinet-grotesk.otf'], ['concrete_albedo.jpg', 'concrete.jpg']]) fs.copyFileSync(`assets/${from}`, `www/brand/${to}`);
  writeHtml(); writeAdmin(); writeDeploy(); writeLeaderboard();
  const ctx = await esbuild.context({
    entryPoints: [{ in: 'src/boot.js', out: 'main' }, 'src/ui.css', 'src/admin.js', 'src/deploy.js', 'src/leaderboard.js'], bundle: true, outdir: 'www', format: 'iife', sourcemap: true, logLevel: 'info', loader,
    plugins: [{ name: 'html', setup(b) { b.onEnd(() => { writeHtml(); writeAdmin(); writeDeploy(); writeLeaderboard(); }); } }],
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'www', port: 5173 });
  console.log(`dev server on http://localhost:${port}`);
} else {
  const r = await esbuild.build({
    entryPoints: ['src/boot.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none', target: 'es2020', loader,
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = fs.readFileSync('src/ui.css', 'utf8');
  fs.mkdirSync('dist', { recursive: true });
  fs.copyFileSync('assets/favicon.png', 'dist/favicon.png');
  fs.copyFileSync('assets/favicon-180.png', 'dist/favicon-180.png');
  const full = fill(tpl, `<style>\n${css}\n</style>`, `<script>\n${js}\n</script>`);
  fs.writeFileSync('dist/index.html', full); // self-hosting (your own site)
  // claude.ai artifact: the host supplies the document skeleton, so drop ours.
  const artifact = full
    .replace(/<!doctype html>\s*|<\/?html[^>]*>\s*|<\/?head>\s*|<\/?body>\s*/gi, '')
    .replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/gi, '')
    .replace(/<title>[^<]*<\/title>/, (t) => `${t}\n<meta name="claude:viewport-fit-sides" content="cover">`);
  fs.writeFileSync('dist/artifact.html', artifact);
  // admin page: wallet sign-in + contract settings (served at /admin on Vercel)
  const ra = await esbuild.build({ entryPoints: ['src/admin.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none', target: 'es2020' });
  const ajs = ra.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync('dist/admin.html', fill(fs.readFileSync('src/admin.html', 'utf8'), '', `<script>\n${ajs}\n</script>`));
  // deploy sandbox: connect a wallet, sign and send the contract deploy transaction yourself (served at /deploy)
  const rd = await esbuild.build({ entryPoints: ['src/deploy.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none', target: 'es2020' });
  const djs = rd.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync('dist/deploy.html', fill(fs.readFileSync('src/deploy.html', 'utf8'), '', `<script>\n${djs}\n</script>`));
  // leaderboard: read-only, no wallet needed (served at /leaderboard)
  const rl = await esbuild.build({ entryPoints: ['src/leaderboard.js'], bundle: true, minify: true, format: 'iife', write: false, legalComments: 'none', target: 'es2020' });
  const ljs = rl.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  fs.writeFileSync('dist/leaderboard.html', fill(fs.readFileSync('src/leaderboard.html', 'utf8'), '', `<script>\n${ljs}\n</script>`));
  // the story page (/story) and the NFT preview (/nfts): written as claude.ai artifacts (no skeleton
  // of their own), so wrap each in a real document here. They share design/nft/ham-art.js, the same
  // art the contracts are generated from. "Play" points at the game on this same domain.
  fs.copyFileSync('design/nft/ham-art.js', 'dist/ham-art.js');
  // the game's own brand files, so the pages look like the game: logo, fonts, title-screen concrete
  fs.mkdirSync('dist/brand', { recursive: true });
  for (const [from, to] of [['logo.png', 'logo.png'], ['bread-island.otf', 'bread-island.otf'], ['cabinet-grotesk.otf', 'cabinet-grotesk.otf'], ['concrete_albedo.jpg', 'concrete.jpg']]) fs.copyFileSync(`assets/${from}`, `dist/brand/${to}`);
  const page = (src, out, desc) => {
    const body = fs.readFileSync(src, 'utf8')
      .replace(/<meta name="claude:viewport-fit-sides"[^>]*>\s*/, '')
      .replaceAll('https://ham-maze.vercel.app', '/')
      .replaceAll('src="ham-art.js"', 'src="/ham-art.js"');
    const title = (body.match(/<title>([^<]*)<\/title>/) || [])[1] || 'HAM';
    fs.writeFileSync(out, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/favicon-180.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`);
  };
  page('site/story.html', 'dist/story.html', 'HAM is a daily maze shooter. Every run becomes a Score NFT, the top three split the pot, and nothing launches a new coin.');
  page('site/nfts.html', 'dist/nfts.html', 'The HAM NFTs: Scores drawn from the day\'s real maze, and Power-Up guns sold in sealed packs.');
  for (const f of ['dist/index.html', 'dist/artifact.html', 'dist/admin.html', 'dist/deploy.html', 'dist/leaderboard.html', 'dist/story.html', 'dist/nfts.html']) console.log(`${f}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}
