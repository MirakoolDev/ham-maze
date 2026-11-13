// Dev:   node build.mjs --dev   -> serves www/ on http://localhost:5173 with rebuild on save
// Build: node build.mjs         -> dist/index.html (self-contained), dist/admin.html, dist/deploy.html
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
  writeHtml(); writeAdmin(); writeDeploy();
  const ctx = await esbuild.context({
    entryPoints: [{ in: 'src/boot.js', out: 'main' }, 'src/ui.css', 'src/admin.js', 'src/deploy.js'], bundle: true, outdir: 'www', format: 'iife', sourcemap: true, logLevel: 'info', loader,
    plugins: [{ name: 'html', setup(b) { b.onEnd(() => { writeHtml(); writeAdmin(); writeDeploy(); }); } }],
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
  for (const f of ['dist/index.html', 'dist/artifact.html', 'dist/admin.html', 'dist/deploy.html']) console.log(`${f}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
}
